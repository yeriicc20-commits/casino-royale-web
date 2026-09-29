using System.IO;
using System.Text;
using System.Xml;
using UnityEditor.Android;
using UnityEngine;

namespace Casino.EditorTools
{
    /// <summary>
    /// Añade al proyecto Android lo que hace falta para instalar una
    /// actualización desde dentro del juego.
    ///
    /// Se hace aquí y no editando un AndroidManifest.xml a mano porque Unity
    /// regenera el proyecto Gradle en cada compilación: un manifiesto editado a
    /// mano se pierde, y se pierde en silencio, de modo que el fallo aparece
    /// semanas después en forma de "el instalador no se abre en el móvil de un
    /// usuario".
    ///
    /// Inyecta dos cosas:
    ///
    ///   1. El permiso REQUEST_INSTALL_PACKAGES. Sin él, Android 8 y
    ///      posteriores ni siquiera permiten PREGUNTAR si se puede instalar.
    ///
    ///   2. Un FileProvider. Desde Android 7 no se puede pasar una ruta file://
    ///      a otra aplicación (FileUriExposedException), así que el APK
    ///      descargado se entrega como content:// a través de este proveedor.
    /// </summary>
    public class UpdateAndroidManifest : IPostGenerateGradleAndroidProject
    {
        public int callbackOrder => 2;

        const string AndroidNamespace = "http://schemas.android.com/apk/res/android";

        public void OnPostGenerateGradleAndroidProject(string path)
        {
            string manifestPath = Path.Combine(path, "src", "main", "AndroidManifest.xml");

            if (!File.Exists(manifestPath))
            {
                Debug.LogWarning("[Android] No se encontró AndroidManifest.xml en " + manifestPath);
                return;
            }

            var document = new XmlDocument();
            document.Load(manifestPath);

            XmlElement root = document.DocumentElement;
            if (root == null) return;

            bool changed = false;

            changed |= EnsurePermission(document, root, "android.permission.REQUEST_INSTALL_PACKAGES");
            changed |= EnsureProvider(document, root);

            if (changed)
            {
                document.Save(manifestPath);
                Debug.Log("[Android] Manifiesto preparado para actualizaciones dentro del juego.");
            }

            WriteFilePaths(path);
        }

        static bool EnsurePermission(XmlDocument document, XmlElement root, string permission)
        {
            foreach (XmlNode node in root.SelectNodes("uses-permission"))
            {
                if (node.Attributes?["android:name"]?.Value == permission) return false;
            }

            XmlElement element = document.CreateElement("uses-permission");
            element.SetAttribute("name", AndroidNamespace, permission);
            root.AppendChild(element);

            return true;
        }

        static bool EnsureProvider(XmlDocument document, XmlElement root)
        {
            XmlNode application = root.SelectSingleNode("application");
            if (application == null) return false;

            string authority = Application.identifier + ".fileprovider";

            foreach (XmlNode node in application.SelectNodes("provider"))
            {
                if (node.Attributes?["android:authorities"]?.Value == authority) return false;
            }

            XmlElement provider = document.CreateElement("provider");
            provider.SetAttribute("name", AndroidNamespace, "androidx.core.content.FileProvider");
            provider.SetAttribute("authorities", AndroidNamespace, authority);

            // No exportado y con permisos concedidos por URI: el instalador
            // recibe acceso solo al archivo concreto que se le entrega, y solo
            // mientras dure ese intent. Exportarlo dejaría que cualquier otra
            // aplicación leyera los archivos del juego.
            provider.SetAttribute("exported", AndroidNamespace, "false");
            provider.SetAttribute("grantUriPermissions", AndroidNamespace, "true");

            XmlElement meta = document.CreateElement("meta-data");
            meta.SetAttribute("name", AndroidNamespace, "android.support.FILE_PROVIDER_PATHS");
            meta.SetAttribute("resource", AndroidNamespace, "@xml/casino_file_paths");
            provider.AppendChild(meta);

            application.AppendChild(provider);
            return true;
        }

        /// <summary>
        /// El XML que le dice al FileProvider qué carpetas puede compartir.
        ///
        /// Solo `files-path` sobre la raíz de los datos de la aplicación, que es
        /// donde persistentDataPath guarda el APK descargado. Nada más: un
        /// proveedor que comparte toda la tarjeta SD es un agujero.
        /// </summary>
        static void WriteFilePaths(string path)
        {
            string folder = Path.Combine(path, "src", "main", "res", "xml");
            Directory.CreateDirectory(folder);

            string file = Path.Combine(folder, "casino_file_paths.xml");

            const string contents =
                "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n" +
                "<paths>\n" +
                "    <files-path name=\"casino_internal\" path=\".\" />\n" +
                "    <external-files-path name=\"casino_external\" path=\".\" />\n" +
                "</paths>\n";

            File.WriteAllText(file, contents, new UTF8Encoding(false));
        }
    }
}
