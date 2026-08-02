

# mLearn

[![Version](https://img.shields.io/github/package-json/v/adrianvla/mLearn?label=version&color=blue)](https://github.com/adrianvla/mLearn/releases)
[![License](https://img.shields.io/badge/license-Sustainable%20Use%20License-green)](LICENSE)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/adrianvla/mLearn)

> **Potencia tu viaje de aprendizaje de idiomas viendo contenido en lengua materna**

mLearn es una aplicación de inmersión todo en uno que sabe lo que sabes. Mira videos, lee manga, chatea con un tutor de IA y repasa tarjetas de memoria, todo mientras la aplicación rastrea pasivamente cada palabra que encuentras para construir un modelo personalizado de tu conocimiento.

**[Sitio web](https://mlearn.kikan.net)** | **[Discord](https://l.kikan.net/mlearn-discord)** | **[Versiones](https://github.com/adrianvla/mLearn/releases)** | **[Incidencias](https://github.com/adrianvla/mLearn/issues)**

<img src="https://mlearn.kikan.net/img/mlearn-screenshot.png" alt="Vista general de mLearn con leyendas de características" width="800" />

<img src="https://mlearn.kikan.net/img/reader-ai-explanation.webp" alt="Lector / OCR — lectura de manga y PDF con OCR en tiempo real" width="800" />
---

## Características

### Modos de aprendizaje principales

| Característica | Descripción |
|---------|-------------|
| **Inmersión por video** | Arrastra y suelta videos o transmite URLs (`.m3u8`, `.mp4`). Superposición de subtítulos con códigos de color y búsqueda instantánea de palabras. Creación de tarjetas de memoria con un clic usando capturas de video. |
| **Lector / OCR** | Abre carpetas de imágenes o PDFs con OCR en tiempo real (RapidOCR, PaddleOCR, MangaOCR). Haz clic en cualquier texto para una búsqueda instantánea. Modo de doble página, alternancia de furigana, lupa. |
| **Agente de conversación con IA** | Tutor de IA completo con chat por voz. Qwen3-4B integrado (se ejecuta sin conexión), Ollama o LLM en la nube. Corrige errores, crea cuestionarios, se adapta a tu nivel. |
| **Tarjetas de memoria SRS** | Repetición espaciada estilo Anki con 5 pestañas: Repasar, Explorar, Generar, Sugeridas, Estadísticas. Generación masiva de TTS, oraciones de ejemplo con LLM, visualización de acento tonal. |
| **Rastreo pasivo de palabras** | Rastrea automáticamente cada palabra que ves/pasas el cursor sobre ella en todos los medios. Las palabras fallidas se agregan automáticamente a tu cola de SRS. |
| **Sincronización de palabras** | Evaluación inteligente de vocabulario con muestreo ponderado potenciado por kanji. Evalúa de manera eficiente lo que realmente no sabes. |

### Sociales y sincronización

| Característica | Descripción |
|---------|-------------|
| **Ver juntos** | Sincroniza la reproducción de videos entre dispositivos. Red local o salas en la nube con reproducción sincronizada en la nube. |
| **Sincronización entre dispositivos** | Sincronización Escritorio ↔ Móvil mediante modo tethered (red local) o en la nube. Configuración bidireccional + sincronización de tarjetas de memoria. |
| **Sincronización de tarjetas en la nube** | Comparte tarjetas de memoria al instante mediante código QR a través de la nube. |

### IA y Voz

| Característica | Descripción |
|---------|-------------|
| **Texto a voz (TTS)** | Kokoro (82M), Qwen3-TTS (1.7B), TTS del sistema o remoto. Clonación de voz con muestras personalizadas. |
| **Voz a texto (STT)** | Whisper-small mediante faster-whisper con Silero VAD. Modos de detección de actividad de voz o presionar para hablar. |
| **Explicador de palabras con LLM** | Explicaciones instantáneas de IA para cualquier palabra con caché de 500 entradas. |
| **Generación masiva con IA** | Genera oraciones de ejemplo y audio para cientos de tarjetas a la vez. |

### Visuales y Personalización

| Característica | Descripción |
|---------|-------------|
| **Superposición de video** | Ventana de subtítulos transparente siempre visible para **cualquier reproductor de video**. Se sincroniza con la extensión del navegador para sitios de streaming. Posicionamiento automático, bloqueo de geometría, arrastrar y soltar subtítulos. |
| **Superposición de texto** | Superposición a pantalla completa para **navegación web**. Haz clic en cualquier texto de una página web para buscar palabras al instante sin salir de la página. |
| **Extensión del navegador** | Extensión para Chrome/Firefox que lleva la superposición de subtítulos de mLearn a cualquier sitio web de streaming. |
| **Panel de estadísticas** | Mapas de calor, rachas, seguimiento de inmersión, actividad de repaso, desglose de niveles, analíticas de adquisición de vocabulario. |
| **Cuadrícula de kanji** | Mapa visual de conocimiento de todos los kanji coloreado por estado con filtrado por nivel. |
| **7 Temas** | Claro, Oscuro, Más oscuro, Alto contraste claro, Alto contraste oscuro, Vidrio claro, Vidrio oscuro. |
| **Sistema de complementos** | Arquitectura extensible de complementos para herramientas de aprendizaje personalizadas. |

### Móvil

| Característica | Descripción |
|---------|-------------|
| **iOS y Android** | 🚧 Próximamente. Aplicación móvil completa mediante Capacitor. Reutiliza rutas de escritorio con diseño optimizado para móvil. El modo tethered se conecta al backend de escritorio. |
| **PWA de tarjetas de memoria** | ✅ [mlearn-app.kikan.net](https://mlearn-app.kikan.net/) — Aplicación web progresiva para repaso de tarjetas. Se sincroniza con el escritorio mediante la nube o modo tethered. Úsala en cualquier dispositivo con un navegador mientras esperas las aplicaciones nativas. [Código fuente](https://github.com/adrianvla/mlearn-mobile-app) |

---

## Novedades en la v2.0

La v2.0 es una reescritura completa en **TypeScript + SolidJS** con capacidades nuevas importantes:

- **Agente de conversación con IA** — Tutor de IA completo con chat por voz, llamada de herramientas y memoria
- **Lector OCR** — Lector de manga/cómic/PDF con 3 motores de OCR
- **Panel de estadísticas** — Analíticas completas con mapas de calor y seguimiento de inmersión
- **Ver juntos** — Visualización de videos sincronizada con sincronización de reproducción en la nube
- **TTS / Voz** — Kokoro, Qwen3-TTS, clonación de voz
- **STT / Reconocimiento de voz** — Entrada de voz basada en Whisper
- **Extensión del navegador** — Extensión para Chrome/Firefox para sitios de streaming
- **Superposición de video** — Subtítulos sincronizados siempre visibles para cualquier reproductor de video
- **Superposición de texto** — Superposición de palabras con búsqueda al hacer clic para navegación web
- **Sincronización entre dispositivos** — Sincronización Móvil ↔ Escritorio
- **Backend en la nube** — Soporte de servidor remoto además de local/tethered
- **Rastreo pasivo de palabras** — Rastrea automáticamente los encuentros de palabras en todos los medios
- **Sincronización de palabras** — Evaluación inteligente de vocabulario con muestreo potenciado por kanji
- **PWA de tarjetas de memoria** — [mlearn-app.kikan.net](https://mlearn-app.kikan.net/) para repaso de tarjetas en cualquier dispositivo con sincronización ([código fuente](https://github.com/adrianvla/mlearn-mobile-app))
- **Aplicación móvil** — iOS/Android mediante Capacitor (próximamente)
- **Sistema de complementos** — Arquitectura extensible de host de complementos
- **Cuadrícula de kanji** — Mapa visual de conocimiento de kanji
- **7 Temas** — Incluyendo temas de vidrio
- **Generación masiva con IA** — TTS masivo + generación de ejemplos
- **Recorte de video** — Recorte automático de segmentos de video para tarjetas de memoria

---

## Soporte de plataformas

| Plataforma | Estado |
|----------|--------|
| macOS (Apple Silicon) | ✅ Completamente compatible |
| macOS (Intel) | ✅ Completamente compatible |
| Linux (x86_64) | ✅ Completamente compatible |
| Windows (x86_64) | ✅ Completamente compatible |
| iOS | 🚧 Próximamente — [Recibe notificaciones](https://mlearn.kikan.net) |
| Android | 🚧 Próximamente — [Recibe notificaciones](https://mlearn.kikan.net) |
| Web (PWA de tarjetas) | ✅ [mlearn-app.kikan.net](https://mlearn-app.kikan.net/) — sincroniza tus tarjetas de memoria y repasa en cualquier dispositivo ([código fuente](https://github.com/adrianvla/mlearn-mobile-app)) |
| Extensión del navegador | ✅ Chrome / Firefox |

---

## Stack tecnológico

| Capa | Tecnología |
|-------|------------|
| **Frontend** | SolidJS (reactividad basada en señales), TypeScript |
| **Escritorio** | Electron 41, arquitectura multi-ventana |
| **Móvil** | Capacitor 8 (iOS/Android) |
| **Backend** | Python FastAPI (puerto 7752) |
| **Compilación** | Vite 6 con configuración personalizada multi-página |
| **Pruebas** | Vitest con cobertura |
| **Estilos** | CSS por componente, sistema de 7 temas |

---


## Capturas de pantalla


<img src="https://mlearn.kikan.net/img/mlearn-screenshot.png" alt="Vista general de mLearn con leyendas de características" width="800" />

<img src="https://mlearn.kikan.net/img/video-player.png" alt="Reproductor de video con superposición de subtítulos y búsqueda de palabras" width="800" />

<img src="https://mlearn.kikan.net/img/reader-ocr.png" alt="Lector / OCR — lectura de manga y PDF con OCR en tiempo real" width="800" />

<img src="https://mlearn.kikan.net/img/reader-ai-explanation.webp" alt="Lector / OCR — lectura de manga y PDF con OCR en tiempo real" width="800" />

<img src="https://mlearn.kikan.net/img/ai-tutor.webp" alt="Agente de conversación con IA con chat por voz" width="800" />

<img src="https://mlearn.kikan.net/img/flashcards.webp" alt="Tarjetas de memoria SRS con repaso y estadísticas" width="800" />

<img src="https://mlearn.kikan.net/img/kanji-grid.webp" alt="Cuadrícula de conocimiento de kanji" width="800" />

<img src="https://mlearn.kikan.net/img/word-tracking.png" alt="Rastreo pasivo de palabras — rastrea automáticamente cada palabra que encuentras" width="800" />

<img src="https://mlearn.kikan.net/img/watch-together.png" alt="Ver juntos — reproducción de video sincronizada entre dispositivos" width="800" />

<img src="https://mlearn.kikan.net/img/overlay-video.png" alt="Superposición de video con subtítulos sincronizados sobre un sitio de streaming" width="800" />

<img src="https://mlearn.kikan.net/img/overlay-web.png" alt="Superposición de texto — haz clic en cualquier texto de una página web para buscar palabras" width="800" />

---

## Inicio rápido

### Descarga
Obtén la última versión desde la [página de liberaciones](https://github.com/adrianvla/mLearn/releases).

### Ejecutar desde el código fuente

```bash
# Clona el repositorio
git clone https://github.com/adrianvla/mLearn.git
cd mLearn

# Instala las dependencias
npm install

# Los datos de idioma y diccionarios se descargan bajo demanda desde el catálogo configurado.
# Consulta "Cómo agregar tu propio idioma" para el contrato del catálogo.

# Modo de desarrollo (Vite + Electron)
npm run dev

# O inicia el servidor de desarrollo móvil
npm run dev:mobile
```

### Compilar para producción

```bash
# macOS
npm run dist:mac

# Windows
npm run dist:win

# Linux
npm run dist:linux

# Todas las plataformas
npm run dist
```

---

## Resumen de la arquitectura

```
Renderer (SolidJS) → getBridge() → Electron IPC | Capacitor local storage
                   → getBackend() → Python Backend (port 7752, HTTP)
Electron Main → Web Server (port 7753, tethered mode)
```

La aplicación utiliza capas de abstracción de plataforma para que el mismo código de renderizador funcione en Electron, Capacitor y web:
- **`getBridge()`** — PlatformBridge para IPC/almacenamiento (16 sub-interfazs)
- **`getBackend()`** — BackendAdapter para llamadas a la API de Python (modos local / tethered / nube)
- **`getPlatform()`** — `'electron' | 'capacitor' | 'web'`

**15 Ventanas de escritorio** (cada una con una entrada Vite separada):
Principal, Bienvenida, Video, Lector, Tarjetas, Agente de conversación, Estadísticas, Configuración, Cuadrícula de kanji, Definición de palabras, Editor de BD de palabras, Sincronización de palabras, Conectar QR, Host de complementos, Licencias, **Superposición**

**Móvil** (en desarrollo): Un solo `mobile.html` con HashRouter, reutiliza rutas de escritorio envueltas en `MobileLayout` + `BottomTabBar`.

---

## Cómo agregar tu propio idioma

Los idiomas se instalan en tiempo de ejecución desde un catálogo de idiomas. La aplicación no requiere módulos de idioma, diccionarios o archivos de frecuencia empaquetados en este repositorio.

La URL del catálogo predeterminada es:

```text
https://mlearn.kikan.net/language-catalog.json
```

Los usuarios y desarrolladores pueden dirigir la aplicación a un catálogo compatible diferente en **Configuración → Conexión → URL del catálogo de idiomas**. Internamente, esta es la configuración `languageCatalogUrl`.

Un catálogo es solo un índice. Le indica a la aplicación qué archivos comprimidos de idiomas y diccionarios están disponibles, dónde descargarlos y qué sumas de verificación verificar. El comportamiento en tiempo de ejecución proviene de los archivos instalados desde esos archivos comprimidos en el directorio `language-data/` del usuario.

### Estructura del catálogo

El catálogo es un archivo JSON con un objeto `languages` de nivel superior. Cada idioma tiene un paquete de idioma principal más paquetes de diccionario opcionales indexados por idioma de definición:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-06T00:00:00.000Z",
  "languages": {
    "example": {
      "name": "Example Language",
      "nameTranslated": "Example",
      "version": "example-package-2026.07.06",
      "minimumAppVersion": "2.7.0",
      "bundle": {
        "url": "https://example.com/language-data/v1/example/language-package-2026.07.06.tar.gz",
        "sizeBytes": 123456,
        "sha256": "..."
      },
      "files": [
        {
          "id": "language-metadata",
          "path": "languages/example.json",
          "required": true
        }
      ],
      "dictionaryPacks": {
        "en": {
          "targetLanguage": "en",
          "name": "English",
          "version": "example-en-dictionary-2026.07.06",
          "bundle": {
            "url": "https://example.com/language-data/v1/example-en/dictionary-2026.07.06.tar.gz",
            "sizeBytes": 123456,
            "sha256": "..."
          },
          "assets": [
            {
              "id": "dictionary-en",
              "path": "dictionaries/example/en/dictionary.db",
              "required": true
            }
          ]
        }
      }
    }
  }
}
```

`bundle.url` también puede escribirse como un `href` relativo; los enlaces relativos se resuelven con respecto a la URL del catálogo. Las rutas de los archivos comprimidos deben ser rutas relativas seguras y su contenido se extrae bajo `files/`.

`minimumAppVersion` es opcional. Cuando está presente, debe ser una versión semántica `mayor.menor.parche`. Los clientes la comparan numéricamente, incluido el orden normal de versiones preliminares, y mantienen los paquetes de idiomas incompatibles visibles pero no disponibles para instalación. Las entradas del catálogo sin ella permanecen compatibles con clientes más antiguos.

### Estructura de archivos instalados

Los paquetes de idiomas principales y los paquetes de diccionarios deben instalarse en rutas estables y agrupadas por idioma:

```text
languages/<code>.json
languages/<code>.freq.json
dictionaries/<code>/<target>/dictionary.db
dictionaries/<code>/<target>/metadata.json
models/<code>/...
adapters/<code>_adapter.py
```

Los paquetes de diccionarios son independientes del paquete de idioma principal para que los usuarios puedan instalar solo los idiomas de definición que necesiten. Un usuario puede instalar varios paquetes de diccionarios para el mismo idioma de aprendizaje, como `ja -> en`, `ja -> fr` y `ja -> de`.

### Metadatos del idioma

El archivo instalado `languages/<code>.json` es el contrato del idioma. Le indica a la aplicación cómo tokenizar, normalizar, mostrar, procesar con OCR, buscar y estudiar el idioma. Prefiere bloques de construcción basados en metadatos sobre comportamientos codificados en la aplicación.

```json
{
  "name": "Example Language",
  "name_translated": "Example",
  "colour_codes": {
    "NOUN": "#ebccfd",
    "VERB": "#ffefd1"
  },
  "translatable": ["NOUN", "VERB"],
  "frequencyLevels": {
    "names": { "1": "A1", "2": "A2" },
    "displayOrder": "ascending",
    "difficulty": "higher-is-harder"
  },
  "textProcessing": {
    "scriptProfile": {
      "acceptedScripts": ["Latn"],
      "wordScriptValidation": "contains-required"
    },
    "lexemeNormalization": {
      "surface": [{ "type": "case-fold" }]
    },
    "readingAnnotation": {
      "enabled": false
    },
    "partOfSpeech": {
      "translatable": ["NOUN", "VERB"],
      "colors": {
        "NOUN": "#ebccfd",
        "VERB": "#ffefd1"
      }
    },
    "tokenJoinSeparator": " "
  },
  "runtime": {
    "nlp": {
      "tokenizer": {
        "type": "unicode-word",
        "capabilities": ["segments"],
        "fallback": "unicode-word"
      },
      "dictionary": {
        "type": "sqlite-zlib-json",
        "schema": "simple-headword-zlib-json",
        "targetPathTemplate": "dictionaries/{language}/{target}/dictionary.db",
        "metadataPath": "dictionaries/example/en/metadata.json",
        "renderer": "simple-glosses"
      }
    }
  },
  "languageData": {
    "version": "example-package-2026.07.06",
    "assets": [
      {
        "id": "language-metadata",
        "path": "languages/example.json",
        "required": true
      },
      {
        "id": "frequency",
        "path": "languages/example.freq.json",
        "required": true
      }
    ],
    "dictionaryPacks": {
      "en": {
        "targetLanguage": "en",
        "name": "English",
        "version": "example-en-dictionary-2026.07.06",
        "assets": [
          {
            "id": "dictionary-en",
            "path": "dictionaries/example/en/dictionary.db",
            "required": true
          },
          {
            "id": "metadata-en",
            "path": "dictionaries/example/en/metadata.json",
            "required": true
          }
        ]
      }
    }
  }
}
```

Las áreas de metadatos más importantes son:

- `runtime.nlp.tokenizer` — declara cómo funciona la tokenización confiable. Usa un tokenizador genérico cuando sea posible; solo añade un adaptador de Python cuando los metadatos no puedan expresar el comportamiento.
- `runtime.nlp.dictionary` — declara el esquema de la base de datos del diccionario instalado y las rutas de búsqueda.
- `textProcessing.scriptProfile` — indica a la aplicación qué scripts cuentan como palabras para el Lector, OCR, subtítulos, STT y filtrado.
- `textProcessing.lexemeNormalization` — mapea formas flexionadas/variantes a candidatos de búsqueda en el diccionario.
- `textProcessing.readingAnnotation` — habilita lecturas estilo ruby/furigana solo para idiomas que realmente las necesitan.
- `textProcessing.partOfSpeech` y `colour_codes` — definen alias de POS, etiquetas traducibles y colores de visualización.
- `frequencyLevels` y `grammarLevels` — definen etiquetas y orden. La interfaz de usuario deriva `visualLevel` de estos metadatos en lugar de asumir JLPT.
- `prosody` — opcional. Úsalo solo cuando el idioma tenga datos de acento/énfasis/tono que deban renderizarse en las superficies de palabras/tarjetas.
- `languageData.dictionaryPacks` — un paquete de diccionario por idioma de definición, p. ej., `ja -> en`, `ja -> fr`, `de -> en`.

### Adaptadores de Python

La mayoría de los idiomas deberían usar `src/root-of-app/generic_language.py` a través de metadatos. Si un idioma necesita un comportamiento que no se puede describir con metadatos, incluye un adaptador en el paquete y habílitalo explícitamente:

```json
{
  "runtime": {
    "nlp": {
      "adapter": {
        "type": "python-module",
        "path": "adapters/example_adapter.py"
      }
    }
  }
}
```

No publiquen `languages/<code>.py` como convención o respaldo. Los archivos de adaptadores no declarados se ignoran.

### Construir un catálogo

Cualquier host estático, CDN o API puede servir un catálogo y archivos compatibles. La implementación oficial de mLearn utiliza el repositorio separado `mlearn-website` para construir diccionarios, empaquetar archivos, cargar activos e implementar el catálogo:

```bash
npm run build:dictionaries
npm run package:language-data
npm run test:language-data
npm run deploy:language-data
```

Esos comandos son detalles de implementación del catálogo oficial, no requisitos para catálogos de terceros. Un catálogo de terceros solo necesita publicar la estructura JSON anterior y servir los archivos referenciados.

### Probar un catálogo

Después de publicar un catálogo o ejecutar uno localmente:

1. Abre Configuración o la ventana de bienvenida.
2. Establece **URL del catálogo de idiomas** en la URL del JSON del catálogo.
3. Selecciona el idioma de aprendizaje.
4. Selecciona el idioma de definición del diccionario.
5. Instala los datos del idioma.
6. Realiza pruebas rápidas de tokenización, búsqueda en diccionario, Lector/OCR, subtítulos, tarjetas de memoria, Sincronización de palabras y Estudio por nivel.

Si la aplicación necesita una nueva capacidad genérica para un idioma, agrégala al esquema compartido de metadatos de idioma y consúmela a través de `src/shared/languageFeatures.ts`; no codifiques una rama de idioma en el código del renderizador o de Electron.

---

## Preguntas frecuentes

### ¿Qué idiomas son compatibles?
mLearn actualmente publica paquetes de **japonés** y **alemán** en el catálogo predeterminado. Se pueden agregar más idiomas publicando metadatos y activos del paquete en un catálogo compatible.

### ¿La aplicación puede funcionar sin conexión?
Sí. Los paquetes de idiomas y diccionarios instalados funcionan sin conexión después de la descarga. Las funciones que dependen de IA en la nube, fuentes de video en línea o un componente de tiempo de ejecución no disponible aún requieren el servicio/componente correspondiente.

### ¿La aplicación puede funcionar sin Anki?
Sí. Las tarjetas de memoria están integradas en mLearn.

### ¿Es gratuita?
mLearn es gratuita para usar y de **código fuente disponible**. Está licenciada bajo la [Licencia de Uso Sostenible v1.0](LICENSE).

> **¿Por qué código fuente disponible?** Este proyecto representa miles de horas de trabajo (alrededor de ~1.5 años de desarrollo al momento de escribir esto) en pipelines de PLN, motores de OCR, sistemas de tutoría con IA y arquitectura multiplataforma. La Licencia de Uso Sostenible mantiene el código transparente y accesible para uso personal y compartir sin fines comerciales, mientras protege contra la reventa o explotación, para que la aplicación pueda permanecer gratuita para los aprendices sin ser desmontada por sus partes.

### ¿Cómo transmito un video?
Pega un enlace a una lista de reproducción de streaming (p. ej., que termine en `.m3u8` o `.mp4`) en el reproductor de video, o arrastra y suelta un archivo de video local.

### ¿Cómo agrego subtítulos?
Arrastra y suelta archivos de subtítulos (`.srt`, `.vtt`, `.ass`) sobre el reproductor de video o la ventana de superposición.

### ¿Cómo funciona la superposición?
**Superposición de video** — Ábrela desde el menú contextual del reproductor de video o a través de la extensión del navegador. Es una ventana transparente siempre visible que se sincroniza con el video y te permite buscar palabras sin salir de tu contenido.

**Superposición de texto** — Activa el modo de texto desde la extensión del navegador o los controles de superposición. La ventana se vuelve a pantalla completa y permite hacer clic a través: haz clic en cualquier texto de una página web para obtener un popup de búsqueda de palabras al instante.

### ¿Dónde se almacenan los datos del idioma?
Los datos del idioma descargados se almacenan en el directorio de datos de la aplicación del usuario bajo `language-data/`. Reemplazar el binario de la aplicación no elimina los paquetes de idiomas o diccionarios instalados.

### ¿Cómo uso la extensión del navegador?
Compílala con `npm run build:extension`, luego carga la carpeta `extension/dist/` como una extensión sin empaquetar en Chrome/Edge/Firefox. Se comunicará con la aplicación de escritorio de mLearn en ejecución.

### ¡Encontré un error!
Por favor, abre un [problema en GitHub](https://github.com/adrianvla/mLearn/issues).

---

## Desarrollo

### Comandos

```bash
npm run dev           # Vite (3000) + Electron concurrente
npm run typecheck     # CRÍTICO: ambos tsconfigs antes de confirmar
npm run build         # Compilación para producción
npm run test          # Vitest (los 3 proyectos)
npm run test:coverage # Vitest con cobertura
npm run dev:mobile    # Modo de observación de Capacitor
npm run build:mobile  # Compilación de Capacitor → dist-mobile/
npm run build:extension # Compilar extensión del navegador
```

### Estructura del proyecto

```
src/
├── electron/        # Proceso principal (CommonJS). IPC, gestión de ventanas, servicios
├── renderer/        # Interfaz UI de SolidJS. Componentes, ventanas, hooks, contextos
├── shared/          # Tipos, constantes, puentes backends de plataforma
├── root-of-app/     # Backend Python FastAPI. PLN, traducción, OCR, TTS
└── html/            # Entradas de ventanas Electron + mobile.html
extension/           # Extensión de navegador Chrome/Firefox
android/, ios/       # Proyectos nativos de Capacitor
examples/plugins/    # Plantillas de complementos
```

### Antes de confirmar cambios
1. `npm run typecheck` — valida ambos tsconfigs
2. Nuevo IPC → agrega a `IPC_CHANNELS`, implementa en ambos puentes
3. Cambios en Configuración → actualiza la interfaz `Settings` + `DEFAULT_SETTINGS`
4. Nuevo código de renderizador → usa `getBridge()`/`getBackend()`, nunca IPC directo

---

## Legal

- Acuerdo de licencia de usuario final: [EULA.md](EULA.md)
- Términos de servicio: [TERMS_OF_SERVICE.md](TERMS_OF_SERVICE.md)
- Política de privacidad: [PRIVACY_POLICY.md](PRIVACY_POLICY.md)
- Guía de despliegue escolar: [SCHOOL_DEPLOYMENT.md](SCHOOL_DEPLOYMENT.md)

Las versiones web de estos documentos están disponibles en [mlearn.kikan.net](https://mlearn.kikan.net).

---

## Licencia

Este software está licenciado bajo la **Licencia de Uso Sostenible v1.0**. Consulte el archivo [LICENSE](LICENSE) para el texto completo.

```
Copyright (C) 2024-2026 Adrian Vlasov

Licencia de Uso Sostenible — Versión 1.0

Al usar el software, usted acepta todos los términos y condiciones a continuación.

El licenciante le otorga una licencia no exclusiva, libre de regalías, mundial,
no sublicenciable, no transferible para usar, copiar,
distribuir, hacer disponible y preparar trabajos derivados del
software, en cada caso sujeto a las limitaciones a continuación.

Solo puede usar o modificar el software para sus propios fines internos
comerciales o para uso no comercial o personal. Usted
solo puede distribuir el software o proporcionarlo a otros si
lo hace sin cargo para fines no comerciales.
```

Las licencias adicionales para bibliotecas de terceros se pueden encontrar en la sección **Configuración → Acerca de** de la aplicación.

---

<p align="center">
  Hecho con ❤
</p>
