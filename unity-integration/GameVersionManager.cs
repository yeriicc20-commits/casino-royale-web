using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;

namespace Casino.Online
{
    /// <summary>
    /// Comprueba la versión contra el servidor y decide qué puede hacer el juego.
    ///
    /// QUÉ PROTEGE ESTO Y QUÉ NO
    ///
    /// Esta clase enseña el diálogo de actualizar. Eso es TODO lo que hace en
    /// términos de seguridad, y no es mucho: cualquiera que modifique el APK
    /// puede saltarse este diálogo en cinco minutos. Lo que de verdad cierra el
    /// online es el servidor, que comprueba la cabecera X-Game-Version en cada
    /// petición y devuelve 426 a las versiones que no llegan al mínimo.
    ///
    /// Es decir: esto es cortesía con el jugador honrado, no una barrera. Por
    /// eso no hay aquí ninguna comprobación "anti-trampas": pondría complejidad
    /// en el único sitio donde no sirve.
    ///
    /// Se monta en el objeto del Bootstrap y sobrevive a los cambios de escena.
    /// </summary>
    [DisallowMultipleComponent]
    public class GameVersionManager : MonoBehaviour
    {
        [Header("Servidor")]
        [Tooltip("Base de la web, sin barra final. Por ejemplo https://casinoroyale.example")]
        public string apiBaseUrl = "https://casinoroyale.example";

        [Tooltip("production, beta o development.")]
        public string channel = "production";

        [Tooltip("Segundos antes de darse por vencido. Corto: el juego no debe quedarse esperando.")]
        public int timeoutSeconds = 8;

        [Header("Comportamiento")]
        [Tooltip("Consultar al arrancar. Déjalo activo salvo que quieras llamarlo tú.")]
        public bool checkOnStart = true;

        // ------------------------------------------------------------ estado

        /// <summary>Último resultado conocido. Nulo hasta la primera consulta.</summary>
        public VersionPayload Latest { get; private set; }

        public UpdateState State { get; private set; } = UpdateState.ServerUnavailable;

        /// <summary>
        /// Si el juego puede entrar al online AHORA MISMO, según lo último que
        /// dijo el servidor. Ante la duda, false: es mejor mandar a alguien al
        /// modo sin conexión que dejarle entrar a un online que le va a fallar.
        /// </summary>
        public bool OnlineAllowed => Latest != null && Latest.onlineAllowed;

        /// <summary>Se dispara cada vez que termina una comprobación.</summary>
        public event Action<UpdateState, VersionPayload> Checked;

        /// <summary>
        /// Se dispara una sola vez, tras actualizar, con las notas de la versión
        /// nueva. Es el "¡Actualización completada!" del flujo.
        /// </summary>
        public event Action<List<ReleaseNote>> UpdateCompleted;

        const string LastSeenKey = "casino.lastSeenVersion";

        static GameVersionManager _instance;
        public static GameVersionManager Instance => _instance;

        void Awake()
        {
            if (_instance != null && _instance != this)
            {
                Destroy(gameObject);
                return;
            }

            _instance = this;
            DontDestroyOnLoad(gameObject);
        }

        void Start()
        {
            if (checkOnStart) StartCoroutine(CheckRoutine());
        }

        /// <summary>Vuelve a preguntar. Se llama al volver de App Store o del instalador.</summary>
        public void CheckNow() => StartCoroutine(CheckRoutine());

        // ------------------------------------------------------------ consulta

        IEnumerator CheckRoutine()
        {
            string url = $"{apiBaseUrl.TrimEnd('/')}/api/game/version" +
                         $"?version={UnityWebRequest.EscapeURL(GameVersion.Current)}" +
                         $"&channel={UnityWebRequest.EscapeURL(channel)}";

            using (UnityWebRequest request = UnityWebRequest.Get(url))
            {
                request.timeout = Mathf.Max(3, timeoutSeconds);

                // La misma cabecera que el servidor usa para decidir. Se manda
                // aquí también para que una petición sin query string siga
                // identificándose.
                request.SetRequestHeader("X-Game-Version", GameVersion.Current);
                request.SetRequestHeader("X-Game-Platform", PlatformName());

                yield return request.SendWebRequest();

                if (request.result != UnityWebRequest.Result.Success)
                {
                    // Sin red no se bloquea nada: el juego sin conexión es el
                    // modo completo y no depende de este servidor para nada.
                    Debug.LogWarning($"[Version] No se pudo consultar: {request.error}");
                    Finish(UpdateState.ServerUnavailable, null);
                    yield break;
                }

                VersionPayload payload;

                try
                {
                    payload = JsonUtility.FromJson<VersionPayload>(request.downloadHandler.text);
                    payload.releaseNotes = ParseNotes(request.downloadHandler.text);
                }
                catch (Exception error)
                {
                    Debug.LogError($"[Version] Respuesta ilegible: {error.Message}");
                    Finish(UpdateState.ServerUnavailable, null);
                    yield break;
                }

                Finish(payload.ToState(), payload);
            }
        }

        void Finish(UpdateState state, VersionPayload payload)
        {
            State = state;
            Latest = payload;

            Checked?.Invoke(state, payload);

            // ¿Venimos de actualizar? Si la versión instalada es mayor que la
            // última que este dispositivo vio, es que se acaba de instalar algo
            // nuevo, y toca enseñar las novedades.
            string lastSeen = PlayerPrefs.GetString(LastSeenKey, "");

            if (!string.IsNullOrEmpty(lastSeen) && GameVersion.IsNewer(GameVersion.Current, lastSeen))
            {
                UpdateCompleted?.Invoke(payload?.releaseNotes ?? new List<ReleaseNote>());
            }

            PlayerPrefs.SetString(LastSeenKey, GameVersion.Current);
            PlayerPrefs.Save();
        }

        // ------------------------------------------------------------ acciones

        /// <summary>
        /// Lleva al jugador a actualizar, por el camino que corresponda a su
        /// plataforma.
        ///
        /// En iOS abre App Store, NUNCA una descarga: Apple no permite instalar
        /// una aplicación desde un archivo bajado de una web, y ofrecerlo solo
        /// produciría un error en el dispositivo.
        /// </summary>
        public void OpenUpdate()
        {
            if (Latest == null) return;

#if UNITY_IOS
            if (!string.IsNullOrEmpty(Latest.iosStoreUrl))
            {
                Application.OpenURL(Latest.iosStoreUrl);
                return;
            }

            Debug.LogWarning("[Version] No hay URL de App Store configurada.");
#elif UNITY_ANDROID
            // En Android se descarga dentro del juego. Ver AndroidUpdateInstaller.
            if (!string.IsNullOrEmpty(Latest.androidDownloadUrl))
            {
                AndroidUpdateInstaller.Instance?.Begin(Latest.androidDownloadUrl, Latest.androidSizeBytes);
                return;
            }

            Debug.LogWarning("[Version] No hay URL de APK configurada.");
#else
            if (!string.IsNullOrEmpty(Latest.windowsDownloadUrl))
            {
                Application.OpenURL(Latest.windowsDownloadUrl);
                return;
            }

            Application.OpenURL(apiBaseUrl.TrimEnd('/') + "/download");
#endif
        }

        /// <summary>
        /// Añade la cabecera de versión a cualquier petición del juego.
        ///
        /// Todas las llamadas online tienen que pasar por aquí: es lo que
        /// permite al servidor rechazar a un cliente desactualizado, y una
        /// petición que se la salte recibirá un 400 en su lugar.
        /// </summary>
        public static void Stamp(UnityWebRequest request)
        {
            if (request == null) return;

            request.SetRequestHeader("X-Game-Version", GameVersion.Current);
            request.SetRequestHeader("X-Game-Platform", PlatformName());
        }

        static string PlatformName()
        {
#if UNITY_ANDROID
            return "android";
#elif UNITY_IOS
            return "ios";
#elif UNITY_STANDALONE_WIN
            return "windows";
#else
            return "other";
#endif
        }

        // ------------------------------------------------------------ parseo

        /// <summary>
        /// Saca las notas del JSON a mano.
        ///
        /// JsonUtility no sabe deserializar un array de objetos con arrays
        /// dentro, y meter una librería entera de JSON en el proyecto por esta
        /// única lista no compensa. Se busca el bloque "releaseNotes" y se leen
        /// sus campos uno a uno.
        /// </summary>
        static List<ReleaseNote> ParseNotes(string json)
        {
            var notes = new List<ReleaseNote>();
            if (string.IsNullOrEmpty(json)) return notes;

            int start = json.IndexOf("\"releaseNotes\"", StringComparison.Ordinal);
            if (start < 0) return notes;

            int open = json.IndexOf('[', start);
            if (open < 0) return notes;

            int depth = 0;
            int close = -1;

            for (int i = open; i < json.Length; i++)
            {
                if (json[i] == '[') depth++;
                else if (json[i] == ']')
                {
                    depth--;
                    if (depth == 0) { close = i; break; }
                }
            }

            if (close < 0) return notes;

            string body = json.Substring(open + 1, close - open - 1);

            foreach (string chunk in SplitObjects(body))
            {
                notes.Add(new ReleaseNote
                {
                    version = Field(chunk, "version"),
                    title = Field(chunk, "title"),
                    summary = Field(chunk, "summary"),
                    releasedAt = Field(chunk, "releasedAt"),
                    added = Array(chunk, "added"),
                    fixedItems = Array(chunk, "fixed"),
                    changed = Array(chunk, "changed"),
                });
            }

            return notes;
        }

        static IEnumerable<string> SplitObjects(string body)
        {
            int depth = 0;
            int start = -1;
            bool inString = false;

            for (int i = 0; i < body.Length; i++)
            {
                char c = body[i];

                // Las llaves dentro de una cadena no cuentan; sin esto, un
                // título que contenga "{" partiría el objeto en dos.
                if (c == '"' && (i == 0 || body[i - 1] != '\\')) inString = !inString;
                if (inString) continue;

                if (c == '{')
                {
                    if (depth == 0) start = i;
                    depth++;
                }
                else if (c == '}')
                {
                    depth--;
                    if (depth == 0 && start >= 0) yield return body.Substring(start, i - start + 1);
                }
            }
        }

        static string Field(string chunk, string name)
        {
            string key = "\"" + name + "\"";
            int at = chunk.IndexOf(key, StringComparison.Ordinal);
            if (at < 0) return "";

            int colon = chunk.IndexOf(':', at + key.Length);
            if (colon < 0) return "";

            int quote = chunk.IndexOf('"', colon);
            if (quote < 0) return "";

            var value = new System.Text.StringBuilder();

            for (int i = quote + 1; i < chunk.Length; i++)
            {
                if (chunk[i] == '\\' && i + 1 < chunk.Length)
                {
                    char next = chunk[++i];
                    value.Append(next == 'n' ? '\n' : next);
                    continue;
                }

                if (chunk[i] == '"') break;
                value.Append(chunk[i]);
            }

            return value.ToString();
        }

        static string[] Array(string chunk, string name)
        {
            string key = "\"" + name + "\"";
            int at = chunk.IndexOf(key, StringComparison.Ordinal);
            if (at < 0) return System.Array.Empty<string>();

            int open = chunk.IndexOf('[', at);
            int close = chunk.IndexOf(']', open + 1);
            if (open < 0 || close < 0) return System.Array.Empty<string>();

            string body = chunk.Substring(open + 1, close - open - 1);
            var items = new List<string>();

            bool inString = false;
            var current = new System.Text.StringBuilder();

            for (int i = 0; i < body.Length; i++)
            {
                char c = body[i];

                if (c == '\\' && inString && i + 1 < body.Length)
                {
                    char next = body[++i];
                    current.Append(next == 'n' ? '\n' : next);
                    continue;
                }

                if (c == '"')
                {
                    if (inString) { items.Add(current.ToString()); current.Clear(); }
                    inString = !inString;
                    continue;
                }

                if (inString) current.Append(c);
            }

            return items.ToArray();
        }
    }
}
