# Verificación de la primera publicación

Realizada el 6 de septiembre de 2026 en Colombia (7 de septiembre UTC).

El juego publicado en https://neiva-abierta.vercel.app respondió HTTP 200 y
se comprobó mediante Chrome real, con un perfil temporal independiente.
El repositorio público es https://github.com/SirHegel/neiva-abierta.

| Comprobación | Resultado observado |
| --- | --- |
| Pruebas Node de cartografía y física | 17 aprobadas, 0 omitidas |
| Compilación web | Terminada en local y Vercel |
| Caminar con teclado | Desplazamiento comprobado |
| Vehículo | Entrada, avance y salida a posición sin colisión |
| Estudio ficticio | Panel abierto, enlace al correo público correcto |
| Pausa y regreso | Estado detenido y reanudado |
| Mapa | Viaje al acceso del Parque Santander y visita registrada |
| Móvil emulado, 320 × 844 y 390 × 844 | Palanca táctil desplaza al personaje |
| Desbordamiento móvil | 0 en ambos tamaños |
| Palanca, interacción, mapa y menú | Dentro de pantalla, blancos de al menos 44 px |
| Errores JavaScript durante esos recorridos | 0 |
| Unreal | JSON y scripts Python validados; C++ sin compilar |

La prueba de producción midió 2.375 ms entre la navegación y la señal de ciudad
preparada, en una única observación a 1440 × 960, Chrome, Mesa Intel UHD Graphics
ADL-S GT0.5. No hubo simulación de red móvil. `σ = desconocida`: una observación
no estima dispersión ni garantiza ese tiempo en otros equipos. La primera prueba
local observó 1.444 ms con el mismo equipo. No son un benchmark de teléfonos físicos.

Reproducir la prueba con el juego servido localmente:

```sh
node scripts/check-browser.mjs
```

Repetir contra un deployment propio:

```sh
GAME_TEST_URL=https://neiva-abierta.vercel.app node scripts/check-browser.mjs
```

El script escribe capturas y resultados en `artifacts/`, excluido de Git.
Necesita Chrome y un servidor gráfico; `HEADLESS=1` permite una alternativa
para funcionalidad, cuyo render por software puede ser mucho más lento.
Los resultados del script no certifican la compilación del proyecto Unreal,
la fidelidad fotográfica ni cobertura completa de barrios/interiores.
