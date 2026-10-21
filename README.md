# Jevlab · Laboratorio de clasificación y extracción de entidades

Aplicación para practicar con textos, comparar resultados y comprender los cálculos de confianza. Incluye clasificación con **Jev / TypeSafe**, extracción de entidades con **GLiNER2** y un laboratorio de fórmulas.

**Con GLiNER instalado, puede extraer entidades con el modelo real en su ordenador, sin simulación y sin clave de API.** Debe abrir la aplicación con `INICIAR.bat` (Windows) o `sh iniciar.sh` (macOS/Linux) y seleccionar **GLiNER local** en la pestaña Entidades.

La aplicación tiene **dos motores independientes**:

- **Clasificación** —pestañas Definición y Resultados—: utiliza Jev / TypeSafe real con una clave personal, o una simulación.
- **Extracción de entidades** —pestaña Entidades—: utiliza GLiNER2 real instalado en su equipo, o una simulación léxica.

Instalar GLiNER habilita la extracción real de entidades. **No activa la clasificación real de Jev**, que necesita su propia clave de TypeSafe. Para utilizar ambos motores reales, configure los dos.

## 1. Descargar la aplicación

1. [Descargue la aplicación en ZIP](https://github.com/majesus/Jevlab/archive/refs/heads/main.zip), o pulse **Code → Download ZIP** en este repositorio.
2. Extraiga **todo** el ZIP en una carpeta donde pueda guardar archivos, por ejemplo, Documentos. No ejecute la aplicación dentro del ZIP.
3. Elija una de las opciones siguientes. **Abrir `index.html` directamente solo permite usar simulación, aunque ya tenga GLiNER instalado.** Para usar cualquiera de los motores reales, arranque el servidor local con el lanzador.

## 2. Elegir qué motores quiere utilizar

| Opción | Clasificación (Jev) | Entidades (GLiNER) | Qué necesita | Cómo abrir |
| --- | --- | --- | --- | --- |
| **A · Todo en simulación** | Simulada | Simuladas | Solo un navegador | `index.html` |
| **B · GLiNER real sin clave de API** | Simulada, si la utiliza | **Modelo real local** | Python e instalación de GLiNER | `INICIAR.bat` o `sh iniciar.sh` |
| **C · Jev real sin instalar GLiNER** | **API real de TypeSafe** | Simuladas, si las utiliza | Python, internet y clave personal de TypeSafe | `INICIAR.bat` o `sh iniciar.sh` |
| **D · Ambos motores reales** | **API real de TypeSafe** | **Modelo real local** | Python, GLiNER instalado y clave de TypeSafe; internet para Jev | `INICIAR.bat` o `sh iniciar.sh` |

Puede trabajar solo en Entidades, sin ejecutar ninguna clasificación. En ese caso, la opción B le permite utilizar GLiNER real sin hacer consultas a Jev.

### A · Todo en simulación: sin instalaciones

1. Abra `index.html` con un navegador actualizado.
2. En **1 · Definición**, elija una plantilla y pulse **Cargar**. Escriba un texto o use el ejemplo y pulse **Ejecutar clasificación**.
3. Consulte **2 · Resultados** y explore el laboratorio de fórmulas.
4. Si quiere ensayar la extracción de entidades, abra **3 · Entidades (GLiNER)** y seleccione **Simulación**.

Este modo funciona sin conexión y no necesita Python ni clave de API. Los resultados proceden de reglas deterministas: sirven para ensayar esquemas y aprender el funcionamiento de la aplicación; **no son respuestas del modelo Jev ni del modelo GLiNER**.

### B · GLiNER2 real: sin simulación de entidades y sin clave de API

Necesita Python **3.10 o superior**; se recomienda **Python 3.12 de 64 bits**. La instalación descarga paquetes y el modelo: necesita internet, espacio disponible y puede tardar varios minutos. No requiere una GPU dedicada.

#### Windows: primera instalación

1. Instale Python 3.12 de 64 bits si todavía no lo tiene. Encontrará los pasos en [la guía completa](LEEME_INSTRUCCIONES.txt).
2. Ejecute `INSTALAR_GLINER.bat` una vez por equipo y cuenta de usuario. Reserve espacio para paquetes y modelo, que pueden ocupar varios GB.
3. Espere al mensaje **«Instalacion y prueba correctas»**. El instalador comprueba las dependencias y realiza una extracción con el modelo real.
4. Ejecute `INICIAR.bat` y mantenga abierta la ventana del servidor mientras trabaja.
5. En **3 · Entidades (GLiNER)**, seleccione **GLiNER local**, espere al servicio y pulse **Extraer entidades**.

#### macOS y Linux: primera instalación

Con Python 3.10 o superior instalado, abra una terminal en la carpeta extraída. Instale GLiNER una vez:

```sh
sh instalar_gliner.sh
```

Cuando la instalación y la prueba del modelo terminen correctamente, arranque la aplicación:

```sh
sh iniciar.sh
```

Mantenga la terminal abierta. En **3 · Entidades (GLiNER)**, seleccione **GLiNER local**, espere al servicio y pulse **Extraer entidades**. Si Linux indica que no puede crear el entorno virtual, consulte el mensaje del instalador: puede faltar el paquete `python3-venv`.

#### Comprobar que la extracción es real

Seleccione **GLiNER local** cuando la actividad requiera el modelo real. Sobre la extracción debe aparecer **«GLiNER2 · fastino/gliner2.5-base-v1»**, o el modelo que haya configurado.

Los tres modos de Entidades se comportan así:

| Selección en Entidades | Qué utiliza | Si el servicio GLiNER no está disponible |
| --- | --- | --- |
| **GLiNER local** | Solo el modelo GLiNER real | Muestra un error; **no sustituye el modelo por simulación** |
| **Automático** | Intenta utilizar GLiNER real | Puede recurrir a simulación; revise el motor indicado en el resultado |
| **Simulación** | Reglas léxicas | Sigue usando simulación, aunque GLiNER esté instalado |

Si el servicio está disponible pero falla la extracción con el modelo, la aplicación muestra el error; tampoco el modo Automático sustituye esa extracción fallida por una simulación.

**«GLiNER disponible» indica que el servicio responde. La confirmación de una extracción real es el nombre GLiNER2 y su modelo sobre el resultado.**

El rótulo **«SIMULACIÓN» de la cabecera se refiere a la clasificación de Jev**. Puede seguir apareciendo mientras Entidades utiliza GLiNER real: no cambia el motor elegido para la extracción.

#### En las siguientes sesiones

Ejecute **`INICIAR.bat`** o **`sh iniciar.sh`**, mantenga abierta su ventana y use **GLiNER local** en Entidades. No necesita reinstalarlo ni activar el entorno a mano. **No abra `index.html` directamente para usar el modelo real.**

El instalador crea el entorno de GLiNER fuera de la aplicación, en una carpeta del usuario. Puede mover la carpeta completa de Jevlab en el mismo equipo y cuenta, con el servidor cerrado. En otro equipo o cuenta, ejecute allí el instalador. Para trabajar sin conexión con el modelo real, consulte la configuración de un modelo local en [la guía completa](LEEME_INSTRUCCIONES.txt).

### C · Jev / TypeSafe real: sin necesidad de instalar GLiNER

Necesita Python **3.8 o superior**, conexión a internet y una clave personal de TypeSafe. Puede utilizar esta opción aunque no haya instalado GLiNER.

1. Obtenga su propia clave en [la consola de TypeSafe](https://console.typesafe.ai/keys).
2. Arranque `INICIAR.bat` en Windows o `sh iniciar.sh` en macOS/Linux.
3. Use la dirección que muestra el servidor, normalmente `http://localhost:8000`. Si el puerto está ocupado, la aplicación puede elegir el siguiente libre.
4. Abra **Configuración**, seleccione **System One real**, introduzca su clave, elija el modelo, por ejemplo, `jev-latest`, y pulse **Guardar**.
5. En **1 · Definición**, cargue una plantilla o configure sus preguntas, introduzca el texto y pulse **Ejecutar clasificación**. Consulte la respuesta en **2 · Resultados**.

El servidor utiliza únicamente la biblioteca estándar de Python; no necesita instalar paquetes para la API de TypeSafe. Abrir `index.html` como archivo permite trabajar en simulación; para los motores reales debe usar la dirección del servidor local.

La clave introducida en la interfaz se conserva en `sessionStorage` de la pestaña. El navegador puede restaurar sesiones: en un equipo compartido, borre la clave en Configuración y cierre la sesión de trabajo. También puede definir `TYPESAFE_API_KEY` antes de arrancar o copiar `config.local.json.example` como `config.local.json` y editar su copia privada. La clave del servidor tiene prioridad sobre la introducida en la interfaz.

Instalar GLiNER no proporciona una clave de TypeSafe. Del mismo modo, configurar la clave de TypeSafe no instala GLiNER. Si no instala GLiNER, puede utilizar la simulación de Entidades o trabajar únicamente con clasificación.

### D · Ambos motores reales: clasificación y entidades sin simulación

1. Complete la instalación de GLiNER de la **opción B**.
2. Arranque la aplicación con `INICIAR.bat` o `sh iniciar.sh`.
3. Configure **System One real** y su clave de TypeSafe como se explica en la **opción C**.
4. En **Entidades**, seleccione **GLiNER local**.
5. Ejecute la clasificación desde **Definición** y la extracción desde **Entidades**. Cada pestaña ejecuta su propia tarea.

Así, **Jev clasifica mediante la API real y GLiNER extrae entidades con el modelo real local**. Ninguna de esas dos tareas utiliza simulación con esas selecciones; si GLiNER falla, se muestra un error. Para usar el mismo texto en ambos motores, pulse **Usar el texto de «Definición»** en Entidades o **→ extraer entidades de este texto** bajo una fila de Resultados.

## Preguntas frecuentes

**¿Basta con abrir `index.html` para cargar GLiNER real?** No. Incluso después de instalar GLiNER, debe arrancar `INICIAR.bat` o `sh iniciar.sh` y utilizar la dirección del servidor local.

**¿Instalar GLiNER elimina toda la simulación de la aplicación?** No. Habilita el modelo real de Entidades. Seleccione **GLiNER local** para exigirlo; la clasificación de Jev tiene su propia configuración.

**¿Puedo usar GLiNER real sin pagar por una API ni introducir una clave?** Sí. GLiNER se ejecuta localmente y no necesita una clave de TypeSafe. La instalación descarga paquetes y el modelo.

**¿Puedo usar Jev real sin instalar GLiNER?** Sí. Necesita Python, conexión y su clave personal de TypeSafe. GLiNER es independiente.

**¿Puedo trabajar sin conexión?** La simulación sí funciona sin conexión. Para GLiNER real, todos los archivos del modelo deben estar disponibles localmente; consulte la configuración de un modelo local en la guía. Jev real necesita conexión a TypeSafe.

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
