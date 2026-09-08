# Voces de personajes

Texto original de Neiva Abierta, MIT. Los diálogos son ficción escrita para el
juego y no representan testimonios de personas reales de Neiva.

Las voces se sintetizan localmente con Piper y el modelo `es_MX-ald-medium`.
Su [ficha de origen](https://huggingface.co/rhasspy/piper-voices/blob/main/es/es_MX/ald/medium/MODEL_CARD)
identifica el dataset de entrenamiento con licencia Unlicense. Se conserva
una copia de esa ficha en `MODEL_CARD`; el manifiesto de diálogo fija URL,
hashes, versión del generador y duración de cada WAV.

Piper se utiliza como herramienta de producción; ni su ejecutable ni el modelo
ONNX se distribuyen con el juego. Los WAV son PCM16 mono de 22.050 Hz. La voz es
sintética y no usa grabaciones de vecinos ni pretende imitar su identidad.
La animación actual no incluye sincronización de labios.

Regeneración: `scripts/generate-dialogue-audio.py --voice MODELO.onnx
--model-card MODEL_CARD --source-url URL_FIJADA`, dentro de un entorno Python
con `piper-tts`. La síntesis puede producir ondas diferentes entre ejecuciones;
los hashes del manifiesto se actualizan junto con los archivos realmente creados.
