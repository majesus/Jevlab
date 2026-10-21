# Jevlab · Laboratorio de clasificación y extracción de entidades

Aplicación para practicar con textos, comparar resultados y comprender los cálculos de confianza. Incluye clasificación con **Jev / TypeSafe**, extracción de entidades con **GLiNER2** y un laboratorio de fórmulas.

**Puede empezar sin instalar nada y sin clave de API:** descargue la aplicación y abra `index.html` para trabajar en simulación.

## Descargar y empezar

1. [Descargue la aplicación en ZIP](https://github.com/majesus/Jevlab/archive/refs/heads/main.zip), o pulse **Code → Download ZIP** en este repositorio.
2. Extraiga **todo** el ZIP en una carpeta donde pueda guardar archivos, por ejemplo, Documentos. No ejecute la aplicación dentro del ZIP.
3. Abra `index.html` con un navegador actualizado.
4. En **1 · Definición**, elija una plantilla y pulse **Cargar**. Escriba un texto o use el ejemplo y pulse **Ejecutar clasificación**.
5. Consulte **2 · Resultados**, pruebe **3 · Entidades (GLiNER)** y explore el laboratorio de fórmulas.

La simulación funciona sin conexión y no necesita Python. Sus resultados proceden de reglas deterministas: sirven para ensayar esquemas y aprender el funcionamiento de la aplicación; **no son respuestas del modelo Jev ni del modelo GLiNER**.

## Elegir el modo de trabajo

| Objetivo | Requisitos | Cómo abrir la aplicación |
| --- | --- | --- |
| Practicar con simulación | Navegador; sin clave ni instalación | Abra `index.html` |
| Extraer entidades con GLiNER2 real, en su ordenador | Python 3.10 o superior; se recomienda 3.12 de 64 bits. Internet para instalar paquetes y descargar el modelo | Instale GLiNER una vez y arranque el servidor local |
| Clasificar con Jev / TypeSafe real | Python 3.8 o superior, conexión a internet y una clave personal de TypeSafe | Arranque el servidor local y configure el modo real |

**La clasificación y la extracción de entidades son independientes.** Puede clasificar en simulación y utilizar GLiNER real para extraer entidades. El rótulo «SIMULACIÓN» de la cabecera se refiere a la clasificación; compruebe también el motor que aparece sobre el resultado de entidades.

## GLiNER2 real: instalación y uso

### Windows

1. Instale Python 3.12 de 64 bits si todavía no lo tiene. Encontrará los pasos en [la guía completa](LEEME_INSTRUCCIONES.txt).
2. Ejecute `INSTALAR_GLINER.bat`. Necesita internet y puede tardar varios minutos; reserve espacio para paquetes y modelo, que pueden ocupar varios GB.
3. Espere al mensaje **«Instalacion y prueba correctas»**. El instalador comprueba las dependencias y realiza una extracción con el modelo real.
4. Ejecute `INICIAR.bat` y mantenga abierta la ventana del servidor mientras trabaja.
5. En **3 · Entidades (GLiNER)**, seleccione **GLiNER local**, espere al servicio y pulse **Extraer entidades**.

### macOS y Linux

Con Python 3.10 o superior instalado, abra una terminal en la carpeta extraída y ejecute:

```sh
sh instalar_gliner.sh
sh iniciar.sh
```

Si Linux indica que no puede crear el entorno virtual, consulte el mensaje del instalador: puede faltar el paquete `python3-venv`.

### Comprobar el resultado

Sobre la extracción debe aparecer **«GLiNER2 · fastino/gliner2.5-base-v1»**, o el modelo que haya configurado. En **GLiNER local**, un fallo se muestra como error. El modo **Automático** puede recurrir a simulación si el servicio no está disponible.

Para las siguientes sesiones basta con ejecutar `INICIAR.bat` o `sh iniciar.sh`. No necesita una clave de TypeSafe para usar GLiNER local.

El instalador crea el entorno de GLiNER fuera de la aplicación, en una carpeta del usuario. Puede mover la carpeta completa de Jevlab en el mismo equipo y cuenta, con el servidor cerrado. En otro equipo o cuenta, ejecute allí el instalador. Para trabajar sin conexión con el modelo real, consulte la configuración de un modelo local en [la guía completa](LEEME_INSTRUCCIONES.txt).

## Jev / TypeSafe: clasificación con la API real

1. Obtenga su propia clave en [la consola de TypeSafe](https://console.typesafe.ai/keys).
2. Arranque `INICIAR.bat` en Windows o `sh iniciar.sh` en macOS/Linux.
3. Use la dirección que muestra el servidor, normalmente `http://localhost:8000`. Si el puerto está ocupado, la aplicación puede elegir el siguiente libre.
4. Abra **Configuración**, seleccione **System One real**, introduzca su clave y elija el modelo, por ejemplo, `jev-latest`.

El servidor utiliza únicamente la biblioteca estándar de Python; no necesita instalar paquetes para la API de TypeSafe. Abrir `index.html` como archivo permite trabajar en simulación; para los motores reales debe usar la dirección del servidor local.

La clave introducida en la interfaz se conserva en `sessionStorage` de la pestaña. El navegador puede restaurar sesiones: en un equipo compartido, borre la clave en Configuración y cierre la sesión de trabajo. También puede definir `TYPESAFE_API_KEY` antes de arrancar o copiar `config.local.json.example` como `config.local.json` y editar su copia privada. La clave del servidor tiene prioridad sobre la introducida en la interfaz.

## Qué puede practicar

- **Choice:** elegir entre categorías definidas por usted.
- **Score:** puntuar en una escala ordinal.
- **Noul:** responder sí/no con probabilidades y umbrales de revisión.
- **Lotes CSV:** clasificar varios textos y exportar resultados a CSV o JSON.
- **Entidades:** definir etiquetas y comparar simulación léxica con GLiNER2 real.
- **Laboratorio de fórmulas:** explorar los cálculos de confianza paso a paso.
- **Plantillas propias:** guardar, exportar e importar preguntas y etiquetas.

La opción **Reutilizar resultados anteriores** conserva respuestas verificadas de Jev durante 24 horas en ese navegador. No guarda en esa caché el texto de entrada ni la clave; sí guarda las respuestas. Puede desactivarla o pulsar **Vaciar caché**. Las plantillas propias también pueden contener los textos que haya guardado como ejemplos. Cada dirección y puerto tiene su propio almacenamiento: use Exportar/Importar para trasladar plantillas.

## Privacidad y archivos locales

Esta distribución no incluye claves de API, credenciales, registros de uso ni entornos instalados. El archivo `config.local.json.example` contiene solo un marcador de ejemplo.

En simulación y con GLiNER local, el texto se procesa en su ordenador. La instalación de GLiNER y la primera descarga del modelo requieren conexión. **En el modo real de Jev, los textos se envían a TypeSafe**: utilice ejemplos adecuados para la práctica y evite información personal o confidencial.

El servidor escucha por defecto en `127.0.0.1`, para uso local. No está preparado para publicar un servicio abierto en internet. La aplicación se descarga desde GitHub y se ejecuta en su equipo.

El repositorio incluye reglas para excluir configuraciones privadas, rutas locales, registros, cachés y modelos descargados. No comparta sus claves ni añada esos archivos al repositorio.

## Si algo falla

| Mensaje o situación | Qué hacer |
| --- | --- |
| No se encuentra Python | Instálelo y vuelva a abrir el lanzador. La simulación sigue disponible con `index.html`. |
| La página se abrió como archivo / sin servidor local | Ejecute el lanzador y use la dirección que muestra su ventana. |
| «Iniciando GLiNER…» | Espere; la interfaz comprueba el servicio durante un máximo de dos minutos. |
| GLiNER no está disponible | Cierre el servidor, ejecute el instalador, compruebe su mensaje final y vuelva a iniciar. |
| HTTP 401 en TypeSafe | Revise su clave personal y la configuración del servidor. |
| HTTP 429 / 529 | Espere y vuelva a intentarlo si se agotan los reintentos automáticos. |
| Se ve una versión antigua | Recargue con `Ctrl+F5`. |

Puede ejecutar un diagnóstico sin mostrar la clave:

```powershell
# Windows, desde la carpeta de la aplicación
py -3 jev_server.py --check
```

```sh
# macOS / Linux
python3 jev_server.py --check
```

Consulte [LEEME_INSTRUCCIONES.txt](LEEME_INSTRUCCIONES.txt) para la instalación de Python, certificados, proxy, modelos locales y más detalles de uso. Si necesita comunicar un problema, puede abrir una [incidencia](https://github.com/majesus/Jevlab/issues) con el sistema operativo, los pasos y el mensaje de error, sin incluir claves ni datos privados.
