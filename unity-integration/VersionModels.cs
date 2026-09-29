using System;
using System.Collections.Generic;

namespace Casino.Online
{
    /// <summary>
    /// En qué situación está esta copia del juego.
    ///
    /// Son cinco y no dos porque las respuestas son distintas: "no llego al
    /// servidor" es un problema de red que se arregla solo, y "tu versión está
    /// prohibida" es algo que el jugador tiene que hacer. Mezclarlos produce el
    /// mensaje inútil de "algo ha salido mal".
    /// </summary>
    public enum UpdateState
    {
        /// <summary>Todo al día. Sin conexión y online disponibles.</summary>
        UpToDate,

        /// <summary>Hay una versión más nueva, pero la instalada sigue valiendo.</summary>
        OptionalUpdate,

        /// <summary>Sin conexión sí; online NO hasta actualizar.</summary>
        UpdateRequired,

        /// <summary>No se pudo consultar. Se juega sin conexión y se reintenta luego.</summary>
        ServerUnavailable,

        /// <summary>El online está cerrado a propósito.</summary>
        Maintenance
    }

    /// <summary>Notas de una versión, para la pantalla de "qué hay de nuevo".</summary>
    [Serializable]
    public class ReleaseNote
    {
        public string version;
        public string title;
        public string summary;
        public string releasedAt;

        public string[] added;
        public string[] fixedItems;      // "fixed" es palabra reservada en C#
        public string[] changed;
    }

    /// <summary>
    /// La respuesta de GET /api/game/version.
    ///
    /// Los nombres coinciden exactamente con el JSON del servidor porque los
    /// rellena JsonUtility, que empareja por nombre de campo. Cambiar uno aquí
    /// sin cambiarlo allí deja el campo en su valor por defecto sin avisar de
    /// nada, que es el tipo de fallo que solo se ve en producción.
    /// </summary>
    [Serializable]
    public class VersionPayload
    {
        public string state;

        public string latestVersion;
        public string minimumOnlineVersion;

        public bool updateRequired;
        public bool updateAvailable;
        public bool onlineAllowed;

        public bool maintenance;
        public string maintenanceMessage;

        public string androidDownloadUrl;
        public int androidVersionCode;
        public long androidSizeBytes;

        public string iosStoreUrl;

        public string windowsDownloadUrl;
        public long windowsSizeBytes;

        public string serverTime;

        /// <summary>
        /// JsonUtility no sabe leer un array de objetos anidados en la raíz de
        /// forma cómoda, así que las notas se parsean aparte en
        /// <see cref="GameVersionService"/>. Este campo queda para el JSON en
        /// crudo por si hace falta depurar.
        /// </summary>
        [NonSerialized] public List<ReleaseNote> releaseNotes = new List<ReleaseNote>();

        public UpdateState ToState()
        {
            switch (state)
            {
                case "UP_TO_DATE":        return UpdateState.UpToDate;
                case "OPTIONAL_UPDATE":   return UpdateState.OptionalUpdate;
                case "UPDATE_REQUIRED":   return UpdateState.UpdateRequired;
                case "MAINTENANCE":       return UpdateState.Maintenance;
                default:                  return UpdateState.ServerUnavailable;
            }
        }
    }

    /// <summary>Progreso de la descarga del APK, para la barra.</summary>
    public struct DownloadProgress
    {
        public float Fraction;          // 0..1
        public long DownloadedBytes;
        public long TotalBytes;
        public float BytesPerSecond;

        public string DownloadedText => Megabytes(DownloadedBytes);
        public string TotalText => Megabytes(TotalBytes);

        public string SpeedText => BytesPerSecond > 0f
            ? (BytesPerSecond / (1024f * 1024f)).ToString("0.0") + " MB/s"
            : "";

        static string Megabytes(long bytes)
            => bytes <= 0 ? "0 MB" : (bytes / (1024f * 1024f)).ToString("0.0") + " MB";
    }
}
