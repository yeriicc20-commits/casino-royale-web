using System;

namespace Casino.Online
{
    /// <summary>
    /// Comparación semántica de versiones.
    ///
    /// Existe porque comparar versiones como texto está mal, y está mal de una
    /// forma que no se nota hasta que el proyecto lleva tiempo: `"1.10.0"` es
    /// MENOR que `"1.2.0"` para string.CompareTo, porque compara carácter a
    /// carácter y el '1' de "10" va antes que el '2'. La décima versión menor
    /// pasaría por anterior a la segunda, y el juego dejaría de pedir la
    /// actualización precisamente a quien lleva más retraso.
    ///
    /// La misma lógica vive en tres sitios a propósito: aquí, en la web y en
    /// PostgreSQL. Cada capa tiene que poder decidir sola. La de PostgreSQL es
    /// la que manda; esta solo elige qué mensaje enseñar.
    /// </summary>
    public static class GameVersion
    {
        /// <summary>La versión de esta compilación, tal y como la dio Unity.</summary>
        public static string Current => UnityEngine.Application.version;

        /// <summary>Devuelve -1 si a &lt; b, 0 si son iguales y 1 si a &gt; b.</summary>
        public static int Compare(string a, string b)
        {
            int[] left = Parse(a);
            int[] right = Parse(b);

            int length = Math.Max(left.Length, right.Length);

            for (int i = 0; i < length; i++)
            {
                // Rellenar con ceros hace que "1.4" y "1.4.0" sean la misma
                // versión, que es lo que espera cualquiera que las escriba.
                int x = i < left.Length ? left[i] : 0;
                int y = i < right.Length ? right[i] : 0;

                if (x > y) return 1;
                if (x < y) return -1;
            }

            return 0;
        }

        public static bool IsNewer(string candidate, string current)
            => Compare(candidate, current) > 0;

        public static bool IsAtLeast(string candidate, string minimum)
            => Compare(candidate, minimum) >= 0;

        /// <summary>
        /// Parte "1.4.2" en {1, 4, 2}. Tolera sufijos: "1.4.2-beta" vale lo
        /// mismo que "1.4.2", porque una compilación de pruebas no debe
        /// considerarse anterior a la versión que lleva dentro.
        /// </summary>
        static int[] Parse(string version)
        {
            if (string.IsNullOrWhiteSpace(version)) return new[] { 0 };

            int cut = version.IndexOfAny(new[] { '-', '+' });
            string core = cut >= 0 ? version.Substring(0, cut) : version;

            string[] parts = core.Trim().Split('.');
            var numbers = new int[parts.Length];

            for (int i = 0; i < parts.Length; i++)
            {
                // Se limpia dígito a dígito en vez de con int.Parse a secas:
                // una versión escrita a mano puede traer espacios o una "v"
                // delante, y eso no debe hacer que la comparación explote.
                int value = 0;
                bool any = false;

                foreach (char c in parts[i])
                {
                    if (c < '0' || c > '9') continue;

                    value = value * 10 + (c - '0');
                    any = true;

                    if (value > 100000) break;   // versión absurda: se corta
                }

                numbers[i] = any ? value : 0;
            }

            return numbers;
        }
    }
}
