#!/usr/bin/env python3
"""
Publica una version nueva del juego, de principio a fin.

    python publicar-version.py 0.2.0 --titulo "Poker y mejoras" \
        --nuevo "Nueva mesa de poker" --nuevo "Bolas simultaneas en Plinko" \
        --corregido "El volumen de la musica ya responde"

Hace, en este orden:

    1. Pone la version en los ajustes de Unity (nombre y versionCode).
    2. Regenera el contenido y compila Android y Windows.
    3. Comprime la version de PC y deja las dos en el Escritorio.
    4. Crea el release en GitHub y sube los dos binarios.
    5. Avisa a la web para que aparezca en /download y /updates.

Existe porque los pasos sueltos se olvidan. La primera vez que alguien compila
pero se salta el paso 5, la web sigue ofreciendo la version anterior y nadie se
entera hasta que un jugador pregunta.

Requisitos:
    - Unity cerrado (el modo batch no puede abrir un proyecto ya abierto).
    - git configurado con acceso al repositorio (el mismo que usas para push).
    - RELEASE_TOKEN en el entorno, con el mismo valor que en Vercel.
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile

# --------------------------------------------------------------------- rutas

PROYECTO = r"C:\Users\xveli\Desktop\Juego Casino movil"
UNITY = r"C:\Program Files\Unity\Hub\Editor\6000.5.8f1\Editor\Unity.exe"
ESCRITORIO = os.path.expanduser(r"~\Desktop")

REPO = "yeriicc20-commits/casino-royale-web"
WEB = "https://casino-royale-web-navy.vercel.app"

AJUSTES = os.path.join(PROYECTO, "ProjectSettings", "ProjectSettings.asset")
APK_BUILD = os.path.join(PROYECTO, "Builds", "Android", "LuckyRoyaleCasino.apk")
WIN_BUILD = os.path.join(PROYECTO, "Builds", "Windows")


def paso(texto):
    print("\n=== %s ===" % texto, flush=True)


# ------------------------------------------------------------------ 1. version

def fijar_version(version):
    """Escribe la version en los ajustes de Unity y sube el versionCode."""
    with open(AJUSTES, encoding="utf-8") as f:
        lineas = f.readlines()

    codigo_nuevo = None

    for i, linea in enumerate(lineas):
        if linea.startswith("  bundleVersion:"):
            lineas[i] = "  bundleVersion: %s\n" % version

        elif linea.startswith("  AndroidBundleVersionCode:"):
            actual = int(linea.split(":")[1].strip())

            # Android EXIGE que suba en cada version; una instalacion no se
            # actualiza sobre otra con el mismo numero o uno menor.
            codigo_nuevo = actual + 1
            lineas[i] = "  AndroidBundleVersionCode: %d\n" % codigo_nuevo

    with open(AJUSTES, "w", encoding="utf-8") as f:
        f.writelines(lineas)

    print("  version %s, versionCode %s" % (version, codigo_nuevo))
    return codigo_nuevo


def leer_version_code():
    """El versionCode con el que se compilo lo que hay en Builds/ (para la web)."""
    with open(AJUSTES, encoding="utf-8") as f:
        for linea in f:
            if linea.startswith("  AndroidBundleVersionCode:"):
                return int(linea.split(":")[1].strip())
    return None


# ------------------------------------------------------------------ 2. compilar

def unity(metodo, log):
    ruta_log = os.path.join(PROYECTO, "Builds", log)
    os.makedirs(os.path.dirname(ruta_log), exist_ok=True)

    resultado = subprocess.run(
        [UNITY, "-batchmode", "-quit", "-nographics",
         "-projectPath", PROYECTO,
         "-executeMethod", metodo,
         "-logFile", ruta_log],
        capture_output=True, text=True)

    if resultado.returncode != 0:
        print("  FALLO. Mira %s" % ruta_log)

        try:
            with open(ruta_log, encoding="utf-8", errors="replace") as f:
                for linea in f.readlines()[-25:]:
                    if "error" in linea.lower() or "Exception" in linea:
                        print("    " + linea.rstrip())
        except OSError:
            pass

        sys.exit(1)


# ------------------------------------------------------------------- 3. empaquetar

def comprimir_pc(destino):
    """Comprime la carpeta de Windows entera."""
    if os.path.exists(destino):
        os.remove(destino)

    with zipfile.ZipFile(destino, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for raiz, _, ficheros in os.walk(WIN_BUILD):
            for fichero in ficheros:
                completo = os.path.join(raiz, fichero)
                z.write(completo, os.path.relpath(completo, WIN_BUILD))

    return os.path.getsize(destino)


# ------------------------------------------------------------------- 4. github

def token_github():
    """El mismo que usa git para hacer push. No se imprime nunca."""
    salida = subprocess.run(
        ["git", "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n",
        capture_output=True, text=True, cwd=os.path.dirname(os.path.abspath(__file__)))

    for linea in salida.stdout.splitlines():
        if linea.startswith("password="):
            return linea.split("=", 1)[1]

    return None


def api_github(token, metodo, url, cuerpo=None, tipo="application/json", binario=None):
    peticion = urllib.request.Request(url, method=metodo)
    peticion.add_header("Authorization", "Bearer " + token)
    peticion.add_header("Accept", "application/vnd.github+json")

    datos = None

    if binario is not None:
        peticion.add_header("Content-Type", tipo)
        datos = binario
    elif cuerpo is not None:
        peticion.add_header("Content-Type", "application/json")
        datos = json.dumps(cuerpo).encode("utf-8")

    try:
        with urllib.request.urlopen(peticion, datos, timeout=900) as respuesta:
            texto = respuesta.read().decode("utf-8")
            return json.loads(texto) if texto else {}
    except urllib.error.HTTPError as error:
        return {"_error": error.code, "_detalle": error.read().decode("utf-8", "replace")[:300]}


def subir_release(token, version, notas, apk, zip_pc):
    etiqueta = "v" + version

    existente = api_github(token, "GET",
                           "https://api.github.com/repos/%s/releases/tags/%s" % (REPO, etiqueta))

    if "id" in existente:
        release_id = existente["id"]
        print("  el release %s ya existia" % etiqueta)
    else:
        creado = api_github(token, "POST",
                            "https://api.github.com/repos/%s/releases" % REPO,
                            {"tag_name": etiqueta,
                             "name": "Casino Royale " + version,
                             "body": notas,
                             "draft": False, "prerelease": False})

        if "id" not in creado:
            print("  no se pudo crear:", creado.get("_detalle", creado))
            sys.exit(1)

        release_id = creado["id"]
        print("  release %s creado" % etiqueta)

    urls = {}

    for ruta, nombre, tipo in [
        (apk, "CasinoRoyale-%s.apk" % version, "application/vnd.android.package-archive"),
        (zip_pc, "CasinoRoyale-%s-PC.zip" % version, "application/zip"),
    ]:
        # Una subida anterior con el mismo nombre hace que GitHub responda 422.
        assets = api_github(token, "GET",
                            "https://api.github.com/repos/%s/releases/%d/assets" % (REPO, release_id))

        if isinstance(assets, list):
            for asset in assets:
                if asset.get("name") == nombre:
                    api_github(token, "DELETE",
                               "https://api.github.com/repos/%s/releases/assets/%d" % (REPO, asset["id"]))

        with open(ruta, "rb") as f:
            contenido = f.read()

        print("  subiendo %s (%.1f MB) ..." % (nombre, len(contenido) / 1048576), end=" ", flush=True)

        resultado = api_github(
            token, "POST",
            "https://uploads.github.com/repos/%s/releases/%d/assets?name=%s" % (REPO, release_id, nombre),
            tipo=tipo, binario=contenido)

        url = resultado.get("browser_download_url")
        print(url or ("FALLO: " + str(resultado.get("_detalle", ""))[:120]))

        if url:
            urls[nombre] = (url, len(contenido))

    return urls


# --------------------------------------------------------------------- 5. web

def avisar_a_la_web(version, codigo, urls, args):
    token = os.environ.get("RELEASE_TOKEN")

    if not token:
        print("  RELEASE_TOKEN no esta en el entorno: la web NO se ha actualizado.")
        print("  Ponlo y vuelve a ejecutar solo este paso, o hazlo desde /admin.")
        return False

    apk = next((v for k, v in urls.items() if k.endswith(".apk")), (None, 0))
    pc = next((v for k, v in urls.items() if k.endswith(".zip")), (None, 0))

    cuerpo = {
        "version": version,
        "title": args.titulo or ("Versión " + version),
        "summary": args.resumen or "",
        "added": args.nuevo,
        "fixed": args.corregido,
        "changed": args.cambiado,
        "androidUrl": apk[0],
        "androidVersionCode": codigo,
        "androidSizeBytes": apk[1],
        "windowsUrl": pc[0],
        "windowsSizeBytes": pc[1],
        "publish": True,
        "requireForOnline": args.obligatoria,
    }

    peticion = urllib.request.Request(WEB + "/api/admin/release", method="POST")
    peticion.add_header("Authorization", "Bearer " + token)
    peticion.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(peticion, json.dumps(cuerpo).encode("utf-8"), timeout=60) as r:
            print("  " + r.read().decode("utf-8"))
            return True
    except urllib.error.HTTPError as error:
        print("  la web respondio %d: %s" % (error.code, error.read().decode("utf-8", "replace")[:200]))
        return False


# --------------------------------------------------------------------- main

def main():
    p = argparse.ArgumentParser(description="Publica una version del juego.")
    p.add_argument("version", help="Por ejemplo 0.2.0")
    p.add_argument("--titulo", default=None)
    p.add_argument("--resumen", default=None)
    p.add_argument("--nuevo", action="append", default=[], help="Una novedad. Repetible.")
    p.add_argument("--corregido", action="append", default=[], help="Una correccion. Repetible.")
    p.add_argument("--cambiado", action="append", default=[], help="Un cambio. Repetible.")
    p.add_argument("--obligatoria", action="store_true",
                   help="Exige esta version para jugar online. Usar con cuidado.")
    p.add_argument("--sin-compilar", action="store_true",
                   help="Usa lo que ya hay en Builds/ en vez de volver a compilar.")

    args = p.parse_args()
    version = args.version.strip()

    codigo = None

    # Con --sin-compilar no se abre Unity en modo batch, asi que puede seguir abierto.
    if not args.sin_compilar and os.path.exists(os.path.join(PROYECTO, "Temp", "UnityLockfile")):
        print("Unity esta abierto. Cierralo antes de compilar.")
        sys.exit(1)

    if not args.sin_compilar:
        paso("1/5  Version en los ajustes de Unity")
        codigo = fijar_version(version)

        paso("2/5  Regenerando contenido")
        unity("Casino.EditorTools.MachineBatchSetup.GenerateMachines", "gen.log")
        print("  hecho")

        paso("3/5  Compilando Android y Windows")
        unity("Casino.EditorTools.BuildRunner.BuildAndroidBatch", "android.log")
        print("  Android listo")
        unity("Casino.EditorTools.BuildRunner.BuildWindowsBatch", "windows.log")
        print("  Windows listo")
    else:
        paso("1-3/5  Saltados: se usa lo que hay en Builds/")
        codigo = leer_version_code()
        print("  versionCode del APK: %s" % codigo)

    paso("4/5  Empaquetando")
    apk = os.path.join(ESCRITORIO, "CasinoRoyale.apk")
    zip_pc = os.path.join(ESCRITORIO, "CasinoRoyale-PC.zip")

    shutil.copy2(APK_BUILD, apk)
    tam = comprimir_pc(zip_pc)

    print("  APK  %.1f MB" % (os.path.getsize(apk) / 1048576))
    print("  PC   %.1f MB" % (tam / 1048576))
    print("  huella del APK: %s" % hashlib.sha256(open(apk, "rb").read()).hexdigest()[:16])

    paso("5/5  Publicando")
    token = token_github()

    if not token:
        print("  sin credencial de GitHub")
        sys.exit(1)

    notas = "\n".join(["- " + n for n in (args.nuevo + args.corregido + args.cambiado)]) or "Version " + version
    urls = subir_release(token, version, notas, apk, zip_pc)

    if len(urls) == 2:
        avisar_a_la_web(version, codigo, urls, args)

    print("\nListo. %s/download" % WEB)


if __name__ == "__main__":
    main()
