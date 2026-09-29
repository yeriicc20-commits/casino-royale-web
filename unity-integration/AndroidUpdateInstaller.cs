using System;
using System.Collections;
using System.IO;
using UnityEngine;
using UnityEngine.Networking;

namespace Casino.Online
{
    /// <summary>
    /// Descarga el APK nuevo y se lo entrega al instalador de Android.
    ///
    /// LO QUE ANDROID PERMITE Y LO QUE NO, sin adornos:
    ///
    /// 1. Una aplicación NO puede instalarse a sí misma en silencio. Lo único
    ///    que se puede hacer es descargar el archivo y abrir el instalador del
    ///    sistema; el jugador tiene que pulsar "Instalar". No hay forma de
    ///    evitar ese paso sin ser una aplicación de sistema.
    ///
    /// 2. Desde Android 8 (API 26) el permiso de "orígenes desconocidos" es POR
    ///    APLICACIÓN. Hay que declarar REQUEST_INSTALL_PACKAGES y, si el
    ///    sistema todavía no nos lo ha concedido, mandar al jugador a esa
    ///    pantalla de ajustes concreta. Los métodos antiguos que activaban un
    ///    ajuste global ya no existen.
    ///
    /// 3. Desde Android 7 (API 24) no se puede pasar una ruta file:// a otra
    ///    aplicación: lanza FileUriExposedException. Hay que usar un
    ///    FileProvider y entregar un content:// con permiso de lectura.
    ///
    /// 4. Google Play PROHÍBE que una aplicación distribuida por Play se
    ///    actualice sola descargando un APK. Mientras el juego se reparta desde
    ///    la web, esto es correcto; el día que se publique en Play hay que
    ///    apagar esta ruta y dejar que Play actualice. Por eso el flujo está
    ///    aislado en esta clase: quitarlo es borrar una llamada.
    ///
    /// El archivo se guarda en persistentDataPath, que es almacenamiento propio
    /// de la aplicación y no necesita ningún permiso de almacenamiento.
    /// </summary>
    [DisallowMultipleComponent]
    public class AndroidUpdateInstaller : MonoBehaviour
    {
        public static AndroidUpdateInstaller Instance { get; private set; }

        /// <summary>Progreso, para pintar la barra.</summary>
        public event Action<DownloadProgress> Progress;

        /// <summary>Descarga terminada. El instalador está a punto de abrirse.</summary>
        public event Action Completed;

        /// <summary>Algo falló. El texto ya viene listo para enseñar.</summary>
        public event Action<string> Failed;

        /// <summary>
        /// Hace falta que el jugador conceda el permiso de instalación. Se le
        /// manda a los ajustes; al volver, se reintenta.
        /// </summary>
        public event Action PermissionNeeded;

        public bool Busy { get; private set; }

        void Awake()
        {
            if (Instance != null && Instance != this) { Destroy(gameObject); return; }

            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        /// <summary>Empieza la descarga. Si ya hay una en marcha, no hace nada.</summary>
        public void Begin(string url, long expectedBytes)
        {
            if (Busy) return;

            if (string.IsNullOrEmpty(url))
            {
                Failed?.Invoke("No hay ninguna descarga configurada.");
                return;
            }

            StartCoroutine(DownloadRoutine(url, expectedBytes));
        }

        IEnumerator DownloadRoutine(string url, long expectedBytes)
        {
            Busy = true;

            // Nombre fijo: si una descarga anterior quedó a medias, esta la
            // sustituye en lugar de ir llenando el disco de archivos sueltos.
            string path = Path.Combine(Application.persistentDataPath, "update.apk");

            try
            {
                if (File.Exists(path)) File.Delete(path);
            }
            catch (Exception error)
            {
                Debug.LogWarning($"[Update] No se pudo limpiar la descarga anterior: {error.Message}");
            }

            using (UnityWebRequest request = UnityWebRequest.Get(url))
            {
                // A disco directamente. Un APK de 70 MB en memoria es un riesgo
                // real de que el sistema mate la aplicación en un móvil justo.
                var handler = new DownloadHandlerFile(path) { removeFileOnAbort = true };
                request.downloadHandler = handler;
                request.timeout = 0;                     // lo marca el progreso, no un reloj

                UnityWebRequestAsyncOperation operation = request.SendWebRequest();

                float startTime = Time.realtimeSinceStartup;
                long lastBytes = 0;
                float lastSample = startTime;

                while (!operation.isDone)
                {
                    long downloaded = (long)request.downloadedBytes;
                    long total = expectedBytes > 0 ? expectedBytes : 0;

                    float now = Time.realtimeSinceStartup;
                    float elapsed = now - lastSample;

                    float speed = 0f;
                    if (elapsed >= 0.5f)
                    {
                        speed = (downloaded - lastBytes) / elapsed;
                        lastBytes = downloaded;
                        lastSample = now;
                    }

                    Progress?.Invoke(new DownloadProgress
                    {
                        // request.downloadProgress solo es fiable si el servidor
                        // manda Content-Length. Cuando no, se calcula con el
                        // tamaño que dio la API.
                        Fraction = total > 0
                            ? Mathf.Clamp01(downloaded / (float)total)
                            : Mathf.Clamp01(request.downloadProgress),
                        DownloadedBytes = downloaded,
                        TotalBytes = total,
                        BytesPerSecond = speed,
                    });

                    yield return null;
                }

                if (request.result != UnityWebRequest.Result.Success)
                {
                    Busy = false;
                    Failed?.Invoke($"No se pudo descargar la actualización: {request.error}");
                    yield break;
                }
            }

            Progress?.Invoke(new DownloadProgress
            {
                Fraction = 1f,
                DownloadedBytes = expectedBytes,
                TotalBytes = expectedBytes,
            });

            Completed?.Invoke();

            // Un respiro para que la interfaz pinte el "Descarga completada"
            // antes de que el instalador tape la pantalla.
            yield return new WaitForSecondsRealtime(0.6f);

            Install(path);
            Busy = false;
        }

        /// <summary>Entrega el archivo al instalador del sistema.</summary>
        public void Install(string apkPath)
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            try
            {
                if (!CanInstall())
                {
                    PermissionNeeded?.Invoke();
                    OpenInstallPermissionSettings();
                    return;
                }

                using (var unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
                using (var activity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity"))
                using (var file = new AndroidJavaObject("java.io.File", apkPath))
                {
                    string authority = Application.identifier + ".fileprovider";

                    // FileProvider: obligatorio desde Android 7. Pasar un
                    // file:// a otra aplicación lanza FileUriExposedException.
                    using (var providerClass = new AndroidJavaClass("androidx.core.content.FileProvider"))
                    using (AndroidJavaObject uri = providerClass.CallStatic<AndroidJavaObject>(
                               "getUriForFile", activity, authority, file))
                    using (var intent = new AndroidJavaObject("android.content.Intent", "android.intent.action.VIEW"))
                    {
                        intent.Call<AndroidJavaObject>("setDataAndType",
                            uri, "application/vnd.android.package-archive");

                        // 1 = FLAG_GRANT_READ_URI_PERMISSION, deja que el
                        //     instalador lea nuestro archivo.
                        // 268435456 = FLAG_ACTIVITY_NEW_TASK, necesario porque
                        //     lo lanza una actividad que se va a cerrar.
                        intent.Call<AndroidJavaObject>("addFlags", 1);
                        intent.Call<AndroidJavaObject>("addFlags", 268435456);

                        activity.Call("startActivity", intent);
                    }
                }
            }
            catch (Exception error)
            {
                Debug.LogError($"[Update] No se pudo abrir el instalador: {error}");
                Failed?.Invoke(
                    "No se pudo abrir el instalador. Busca el archivo update.apk en la " +
                    "carpeta de la aplicación y ábrelo a mano.");
            }
#else
            Debug.Log($"[Update] (Solo Android) Se instalaría: {apkPath}");
#endif
        }

        /// <summary>¿Nos ha dado el sistema permiso para instalar aplicaciones?</summary>
        public static bool CanInstall()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            try
            {
                using (var version = new AndroidJavaClass("android.os.Build$VERSION"))
                {
                    // Por debajo de Android 8 el permiso era global y se
                    // concedía en los ajustes del sistema, no por aplicación.
                    if (version.GetStatic<int>("SDK_INT") < 26) return true;
                }

                using (var unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
                using (var activity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity"))
                using (AndroidJavaObject manager = activity.Call<AndroidJavaObject>("getPackageManager"))
                {
                    return manager.Call<bool>("canRequestPackageInstalls");
                }
            }
            catch (Exception error)
            {
                Debug.LogWarning($"[Update] No se pudo comprobar el permiso: {error.Message}");
                return false;
            }
#else
            return false;
#endif
        }

        /// <summary>
        /// Abre la pantalla de ajustes de ESTA aplicación para conceder el
        /// permiso de instalación. No existe forma de pedirlo con un diálogo:
        /// Android obliga a pasar por ajustes.
        /// </summary>
        public static void OpenInstallPermissionSettings()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            try
            {
                using (var unityPlayer = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
                using (var activity = unityPlayer.GetStatic<AndroidJavaObject>("currentActivity"))
                using (var uriClass = new AndroidJavaClass("android.net.Uri"))
                using (AndroidJavaObject uri = uriClass.CallStatic<AndroidJavaObject>(
                           "parse", "package:" + Application.identifier))
                using (var intent = new AndroidJavaObject("android.content.Intent",
                           "android.settings.MANAGE_UNKNOWN_APP_SOURCES", uri))
                {
                    intent.Call<AndroidJavaObject>("addFlags", 268435456);
                    activity.Call("startActivity", intent);
                }
            }
            catch (Exception error)
            {
                Debug.LogError($"[Update] No se pudieron abrir los ajustes: {error}");
            }
#endif
        }
    }
}
