# Casino Royale — web oficial, backend y actualizaciones

Todo lo que hay fuera del juego: la web pública, la base de datos, el panel de
administración, la API que consulta Unity y el sistema de actualizaciones para
Android, iOS y Windows.

```
CasinoWeb/
├── web/                 La web (Next.js 14 + TypeScript + Tailwind)
├── backend/             SQL de Supabase: esquema, permisos y datos de ejemplo
├── unity-integration/   C# para pegar en el proyecto de Unity
├── docs/                Guías de despliegue y operación
└── .github/workflows/   Cron gratuito que evita que Supabase se pause
```

---

## Antes de nada: qué es gratis y hasta dónde

Esto es lo que más importa, así que va primero y sin rodeos.

| Servicio | Para qué | Plan gratuito | Cuándo empieza a costar | Alternativa gratuita |
|---|---|---|---|---|
| **Supabase** | Base de datos, cuentas, permisos | 500 MB de base, 50.000 usuarios activos/mes, 5 GB de tráfico, 1 GB de archivos | Al superar esos límites, o si quieres que no se pause | Neon + Auth.js, o Firebase (ver abajo) |
| **Vercel** | Alojar la web | 100 GB de tráfico/mes, funciones incluidas | Uso comercial, o al superar el tráfico | Cloudflare Pages (sin cláusula comercial) |
| **GitHub Releases** | Guardar el APK y el ZIP de PC | 2 GB por archivo, tráfico sin tope práctico en repos públicos | Prácticamente nunca a esta escala | Cloudflare R2 (10 GB gratis) |
| **GitHub Actions** | Cron diario | Ilimitado en repos públicos, 2.000 min/mes en privados | Nunca a este uso | cron-job.org |
| **Cloudflare** | DNS y dominio | DNS gratis | El dominio en sí, unos 10 €/año | Un subdominio gratuito de Vercel |

**El único gasto inevitable es el dominio** (~10 €/año), y ni siquiera: puedes
usar `tu-proyecto.vercel.app` indefinidamente.

**Si algún día quieres iniciar sesión con Apple**, ahí sí hay un coste: Apple
exige una cuenta de desarrollador de 99 $/año para emitir las claves. Google y
el correo son gratis, así que el botón de Apple está programado pero puedes
dejarlo apagado.

### Dos límites que te van a morder si no los conoces

1. **Supabase gratuito se pausa a los 7 días sin actividad.** Por eso existe
   `.github/workflows/keepalive.yml`. Configúralo: sin él, el juego se queda sin
   servidor de versiones solo o.
2. **El plan Hobby de Vercel es para uso no comercial.** Mientras el juego no
   tenga ingresos, estás dentro. El día que monetices, o pasas al plan Pro
   (20 $/mes) o mueves la web a Cloudflare Pages, que no tiene esa cláusula.

### Por qué Supabase y no Firebase

Firebase Cloud Functions **exige el plan Blaze desde 2024**, y el plan Blaze
pide una tarjeta. Como la comprobación de versión tiene que ejecutarse en el
servidor (si vive en el cliente, no protege nada), con Firebase habría que
registrar una tarjeta el primer día. Supabase incluye Edge Functions y Postgres
sin tarjeta.

Además, versiones y changelogs son datos **relacionales y ordenados**: en SQL es
natural, y las *Row Level Security policies* son exactamente el mecanismo que
hace cumplir "no te fíes del cliente" dentro de la base de datos.

---

## 1. Instalar el proyecto

Necesitas Node 18 o superior.

```bash
cd CasinoWeb/web
npm install
```

## 2. Ejecutarlo en tu ordenador

```bash
cp .env.example .env.local     # y rellena los valores del paso 3
npm run dev
```

Abre http://localhost:3000.

La web **arranca aunque Supabase no responda**: las páginas dicen "todavía no
hay versiones publicadas" en lugar de dar error. Eso es a propósito.

## 3. Configurar Supabase

1. Crea una cuenta en [supabase.com](https://supabase.com) y un proyecto nuevo.
   Elige la región **más cercana a tus jugadores** (para España, Frankfurt).
2. Ve a **SQL Editor** y ejecuta, en este orden:
   - `backend/01_schema.sql`
   - `backend/02_policies.sql`
   - `backend/03_seed.sql`
3. Ve a **Settings → API** y copia:
   - *Project URL* → `NEXT_PUBLIC_SUPABASE_URL`
   - *anon public* → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - *service_role* → `SUPABASE_SERVICE_ROLE_KEY`

> **La clave `service_role` se salta todas las reglas de seguridad.** Trátala
> como la contraseña de la base de datos. Nunca la pongas en una variable que
> empiece por `NEXT_PUBLIC_`, porque todo lo que lleva ese prefijo se copia
> dentro del JavaScript que descarga el navegador.

## 4. Configurar Google Sign-In

1. En [Google Cloud Console](https://console.cloud.google.com), crea un proyecto.
2. **APIs y servicios → Pantalla de consentimiento de OAuth**: tipo *Externo*,
   rellena nombre y correo.
3. **Credenciales → Crear credenciales → ID de cliente de OAuth**, tipo
   *Aplicación web*.
4. En *URI de redirección autorizados* pon la que te da Supabase en
   **Authentication → Providers → Google** (algo como
   `https://TU-PROYECTO.supabase.co/auth/v1/callback`).
5. Copia el *Client ID* y el *Client secret* en Supabase y activa el proveedor.

Gratis, sin límite práctico.

## 5. Configurar Apple Sign-In

Requiere **Apple Developer Program, 99 $/año**. Si aún no lo tienes, sáltate
este paso: el botón se puede desactivar en `components/LoginForm.tsx` poniendo
`enabled: false` en la entrada de `apple`.

Cuando lo tengas:

1. En [developer.apple.com](https://developer.apple.com), crea un *App ID* con
   *Sign in with Apple* activado.
2. Crea un *Services ID* y añade el dominio y la URL de retorno de Supabase.
3. Crea una *Key* con *Sign in with Apple*, descarga el `.p8`.
4. En Supabase → **Authentication → Providers → Apple**, pega el Services ID,
   el Team ID, el Key ID y el contenido del `.p8`.

## 6. Configurar el dominio

1. Compra el dominio donde prefieras (Cloudflare lo vende a precio de coste).
2. En Vercel → **Settings → Domains**, añádelo.
3. Vercel te dará un registro que copiar en el DNS. Con Cloudflare, pon el
   proxy en **DNS only** para el registro de Vercel.
4. Actualiza `NEXT_PUBLIC_SITE_URL` con el dominio final.

## 7. Publicar la web

```bash
cd CasinoWeb/web
npx vercel            # la primera vez, sigue el asistente
npx vercel --prod     # publicar
```

O conecta el repositorio de GitHub a Vercel y cada `git push` publicará solo.

**Copia todas las variables de `.env.local` en Vercel** →
*Settings → Environment Variables*. Si falta `SUPABASE_SERVICE_ROLE_KEY`, la web
se construye pero no muestra ninguna versión.

## 8. Subir una versión nueva de Android

El APK **no va a Supabase** (1 GB en total, unos trece APK). Va a GitHub
Releases, que admite 2 GB por archivo:

1. En tu repositorio, **Releases → Draft a new release**.
2. Etiqueta `v1.4.0`, y arrastra el `.apk` (y el `.zip` de Windows si lo hay).
3. Publica y **copia el enlace directo** del archivo. Tiene esta forma:
   `https://github.com/usuario/repo/releases/download/v1.4.0/casino.apk`
4. Anota el tamaño en bytes: `ls -l casino.apk` en Git Bash, o Propiedades en
   el explorador.

## 9. Publicar una actualización

1. Entra en `/admin` con tu cuenta de administrador.
2. Baja a **Publicar una versión nueva** y rellena:
   - versión (`1.4.0`), canal (`production`), estado (`published`)
   - título y resumen
   - novedades, correcciones y cambios, **una por línea**
   - la URL del APK, el `versionCode` y el tamaño en bytes
3. Guarda. La web se actualiza sola en menos de un minuto.

En este punto la versión ya es **descargable**, pero **todavía no es
obligatoria**: quien tenga una anterior seguirá jugando online sin problema.

## 10. Cambiar la versión mínima para el online

Este es el interruptor con más alcance de todo el panel.

1. En `/admin`, en **Configuración del canal**, sube
   **Versión mínima para el online** a la nueva.
2. Guarda.

A partir de ese momento:
- Quien tenga una versión inferior verá "Nueva actualización disponible" y no
  podrá entrar al online.
- El modo **sin conexión sigue funcionando** para todo el mundo.
- El servidor rechaza sus peticiones con `426 CLIENT_UPDATE_REQUIRED`, aunque
  hayan modificado el juego para saltarse el diálogo.

> **Súbela solo cuando la versión nueva ya esté publicada y descargable.** Si la
> subes antes, dejas a todo el mundo fuera del online sin nada que instalar.

## 10-bis. Encender el modo ONLINE del juego

Esto es lo que hace que el juego tenga amigos, clasificación y partida en la nube.

**Importante:** el juego habla un protocolo propio, distinto del de la web. Son
ocho rutas bajo `/api`, ya implementadas en este proyecto:

| Ruta | Qué hace |
|---|---|
| `POST /api/system/time` | El latido. Si responde, el juego pasa a Online |
| `POST /api/profile/load` | Descarga la partida guardada |
| `POST /api/profile/save` | La sube, sin pisar una revisión más nueva |
| `POST /api/social/presence` | "Estoy aquí" + saldo para la clasificación |
| `POST /api/social/friends` | Lista de amigos |
| `POST /api/social/friends/add` | Añadir por código |
| `POST /api/social/friends/remove` | Quitar |
| `POST /api/social/leaderboard` | Ranking global o de amigos |

Pasos:

1. **Ejecuta `backend/04_online.sql`** en el SQL Editor de Supabase, después de
   los otros tres. Crea `online_players`, `online_friends` y `online_profiles`.
2. **Publica la web** (paso 7). Las rutas van dentro.
3. **Comprueba que responde**, desde cualquier navegador o terminal:

   ```
   curl -X POST https://TU-DOMINIO/api/system/time -d "{}"
   ```

   Tiene que devolver algo como `{"utc":"2026-09-29T10:15:02.062Z"}`.
4. **Apunta el juego a tu dominio**: en Unity, abre
   `Assets/_Project/ScriptableObjects/BackendConfig.asset` y pon en **Base Url**:

   ```
   https://TU-DOMINIO/api
   ```

   Con `/api` al final. Sin eso, el juego llamaría a `/profile/load` en la raíz,
   donde no hay nada.
5. **Recompila** el APK y el ejecutable.

Al abrir el juego, la pantalla de inicio ofrecerá **JUGAR ONLINE** y el registro
dirá `[Backend] Mode is now Online.`

### Por qué el saldo no es de fiar (todavía)

`social/presence` acepta el saldo que le manda el móvil. Es deliberado: el dinero
es ficticio y la clasificación es un adorno. Si algún día hay algo en juego, el
sitio donde validarlo es esa ruta —comparando contra las rondas registradas en el
servidor— y no el cliente, que cualquiera puede modificar.

Lo que **sí** está protegido: nadie puede leer ni escribir la partida de otro. Las
tres tablas tienen Row Level Security activado y **cero políticas**, así que con la
clave pública son invisibles; solo las rutas del servidor, que usan la clave de
servicio, las tocan.

## 11. Conectar Unity

1. Copia los `.cs` de `unity-integration/` a
   `Assets/_Project/Scripts/Online/`, y los de `unity-integration/Editor/` a
   `Assets/_Project/Editor/Build/`.
2. En la escena `00_Bootstrap`, añade a un objeto que sobreviva a las escenas:
   - `GameVersionManager` — pon tu dominio en **Api Base Url**
   - `AndroidUpdateInstaller`
3. Haz que **todas** las peticiones online pasen por
   `GameVersionManager.Stamp(request)`; es lo que añade la cabecera
   `X-Game-Version` que el servidor comprueba.
4. Comprueba que la versión de Unity (**Project Settings → Player → Version**)
   coincide con la que publicas en el panel. `Application.version` sale de ahí.

```csharp
// Bloquear el online cuando toque
if (!GameVersionManager.Instance.OnlineAllowed)
{
    // enseña el diálogo y deja solo el modo sin conexión
}
```

## 12. Configurar App Store

Cuando publiques en App Store:

1. Copia la URL de la ficha (`https://apps.apple.com/app/idXXXXXXXXXX`).
2. Pégala en `/admin` → **URL de App Store**.

Ya está. El juego abrirá esa ficha cuando toque actualizar en iOS, y la web
enseñará el botón "Ver en App Store" en lugar de "no disponible".

**No intentes servir un `.ipa` desde la web.** Fuera de TestFlight y de los
programas de empresa, iOS lo rechaza. No es una limitación evitable.

## 13. Configurar Android

En el proyecto de Unity, **Project Settings → Player → Android**:

- **Version**: `1.4.0` (lo que lee `Application.version`)
- **Bundle Version Code**: `140` (el `versionCode` que pones en el panel)
- **Minimum API Level**: 26 o superior
- **Scripting Backend**: IL2CPP, con ARMv7 y ARM64

El script `UpdateAndroidManifest.cs` añade solo el permiso
`REQUEST_INSTALL_PACKAGES` y el `FileProvider` en cada compilación. No edites el
`AndroidManifest.xml` a mano: Unity lo regenera y perderías los cambios sin
darte cuenta.

## 14. Usar el panel de administración

`/admin`, con una cuenta que tenga el rol `admin`.

Para darte ese rol la primera vez, en el SQL Editor de Supabase:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'TU-CORREO@ejemplo.com');
```

Se hace a mano a propósito: **no existe ninguna forma desde la web** de que
alguien se convierta en administrador.

Desde el panel puedes crear y editar versiones, publicarlas y despublicarlas,
cambiar la versión mínima del online y activar el mantenimiento.

## 15. Volver a una versión anterior

Si una versión sale mal:

1. En `/admin`, **despublica** la versión problemática (botón *Despublicar*).
2. Baja **Versión mínima para el online** a la anterior que funcionaba.
3. Baja **Versión actual** a esa misma.

La web volverá a ofrecer la versión anterior y el online aceptará de nuevo a
quien la tenga. Nada se borra: la versión retirada sigue en la base de datos
por si quieres volver a publicarla corregida.

## 16. Copias de seguridad

- **Supabase**: el plan gratuito hace copias diarias con 7 días de retención.
  Para una copia propia: **Database → Backups → Download**, o
  `pg_dump` con la cadena de conexión de *Settings → Database*.
- **Los binarios** ya están en GitHub Releases, que es en sí una copia.
- **El código** vive en Git. Haz `git push` a menudo.

Una copia mensual del SQL guardada fuera de Supabase cubre el caso de que
pierdas acceso a la cuenta.

---

## La API que consulta Unity

### `GET /api/game/version`

```
GET /api/game/version?version=1.3.0&channel=production
X-Game-Version: 1.3.0
```

```json
{
  "state": "UPDATE_REQUIRED",
  "latestVersion": "1.4.0",
  "minimumOnlineVersion": "1.4.0",
  "updateRequired": true,
  "updateAvailable": true,
  "onlineAllowed": false,
  "maintenance": false,
  "maintenanceMessage": null,
  "androidDownloadUrl": "https://github.com/.../casino.apk",
  "androidVersionCode": 140,
  "androidSizeBytes": 71303168,
  "iosStoreUrl": "https://apps.apple.com/app/id...",
  "windowsDownloadUrl": "https://github.com/.../casino-win.zip",
  "windowsSizeBytes": 94371840,
  "releaseNotes": [ { "version": "1.4.0", "title": "...", "added": ["..."] } ],
  "serverTime": "2026-09-29T10:00:00.000Z"
}
```

Otros endpoints:

| Ruta | Para qué |
|---|---|
| `GET /api/game/updates` | Historial completo de versiones |
| `GET /api/game/updates/latest` | Solo la más reciente |
| `GET /api/game/maintenance` | Respuesta mínima para sondear el estado |
| `GET/POST /api/user/profile` | Perfil y guardado. **Protegido por versión** |
| `GET /api/cron/keepalive` | Ping del cron. Requiere `CRON_SECRET` |

### Qué usa REST y qué usa el SDK

- **REST (rutas de `/api`)** para todo lo que consulta **Unity**: así el juego
  nunca lleva dentro ninguna clave de Supabase, y el servidor puede comprobar la
  versión antes de responder.
- **SDK de Supabase directamente** para lo que hace **la web**: iniciar sesión,
  leer el perfil, guardar ajustes. Las políticas RLS ya deciden qué puede ver
  cada usuario, así que una capa REST intermedia solo añadiría código sin añadir
  seguridad.

---

## Seguridad: qué hace cada lado

Esta es la parte que más se malinterpreta, así que va explícita.

### Lo que hace Unity (y NO es seguridad)

- Enseñar el diálogo de "Nueva actualización disponible".
- Ocultar el botón de online cuando la versión es antigua.
- Enviar la cabecera `X-Game-Version`.

**Nada de esto protege.** Quien modifique el APK puede saltárselo todo. Es
comodidad para el jugador honrado, y así está comentado en el código.

### Lo que hace el servidor (y SÍ es seguridad)

- **Comprobar la versión en cada petición protegida.** `guardOnlineAccess()`
  devuelve `426` a cualquier cliente por debajo de `minimum_online_version`,
  tenga sesión válida o no. Esto es lo único que de verdad cierra el online.
- **Row Level Security.** La clave anónima es pública; lo que impide leer los
  datos de otro no es esconderla, son las políticas dentro de Postgres.
- **`submit_round()`.** El saldo de confianza solo cambia por esta función, que
  comprueba que la apuesta cabe en el saldo, que el pago no supera el techo de
  la máquina y que las rondas no llegan a una velocidad imposible.
- **El rol de administrador** se comprueba dentro de cada Server Action, no solo
  en el middleware.

### Lo que este diseño NO resuelve

Sé claro contigo mismo sobre esto: el juego **no es servidor-autoritativo**. La
tirada se decide en el cliente. `submit_round()` acota lo que un cliente
modificado puede reclamar, pero alguien decidido puede seguir reportando
victorias plausibles repetidas.

Hacerlo a prueba de trampas exige mover la lógica de cada máquina al servidor,
que es un proyecto en sí mismo. Mientras no lo sea, la clasificación es "quién
ha jugado mucho con suerte", no una competición con dinero detrás — y como el
dinero es ficticio, el incentivo para hacer trampas es bajo.

Lo que sí está protegido pase lo que pase: **nadie puede leer ni escribir los
datos de otra persona**, y **nadie puede entrar al online con una versión
incompatible**.

---

## Analítica

No hay ninguna instalada, y la política de privacidad lo dice. Si quieres
añadirla, la opción gratuita que respeta la privacidad es
[Plausible en modo self-hosted](https://plausible.io/self-hosted-web-analytics)
o [Umami](https://umami.is) en un contenedor gratuito. Vercel Analytics tiene un
plan gratuito limitado y no usa cookies.

Si añades cualquiera que use cookies, hay que implementar el consentimiento
**antes** de activarla, y actualizar `/privacy` el mismo día.
