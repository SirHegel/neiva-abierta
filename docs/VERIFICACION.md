# Verificación de la edición 0.2

Realizada el 6 de septiembre de 2026 en Colombia (7 de septiembre UTC).
Esta revisión sustituye el render inicial por modelos detallados, materiales
fotográficos, fachadas con textura y geometría, tejados, vegetación con hojas
recortadas, una Catedral específica y sombras solares.

| Comprobación | Resultado observado |
| --- | --- |
| Pruebas Node de cartografía y física | 17 aprobadas, 0 omitidas |
| Contrato de importación de arte para Unreal | 7 pruebas Python aprobadas |
| Fuentes de arte y mapas | Validados; 46 entradas del manifiesto de texturas verificadas por SHA-256 |
| Compilación web | Aprobada |
| Navegador, 1440 × 960 | Versión gráfica `0.2-photographic` cargada |
| Caminar y vehículo | Desplazamiento, entrada, avance y salida sin colisión comprobados |
| Estudio ficticio | Panel y enlace de correo público comprobados; no se envía correo |
| Pausa y regreso | Estado detenido y reanudado |
| Mapa | Viaje al acceso del Parque Santander y visita registrada |
| Móvil emulado, 320 × 844 y 390 × 844 | Palanca, estudio y viaje con mapa comprobados |
| Desbordamiento móvil | 0 en ambos tamaños |
| Palanca, interacción, mapa y menú | Dentro de pantalla, blancos de al menos 44 px |
| Errores JavaScript/console.error | 0 en los tres recorridos |
| Unreal | Fuentes, contrato de arte y sintaxis Python validados; C++ sin compilar |

Las capturas se inspeccionaron para comprobar la carga del humano animado,
el automóvil detallado, las fachadas, las hojas con transparencia y las sombras.
`public/preview.webp` es una captura real del canvas, sin la interfaz; se utiliza
también en la tarjeta de Juegos del sitio. Las fachadas generadas y la Catedral
son recreaciones, no evidencia de un levantamiento fotográfico de Neiva.

El recorrido local completo usó Chrome real con Mesa Intel UHD Graphics
ADL-S GT0.5. La primera carga observada fue de 10.143 ms, incluyendo materiales,
modelos y cartografía. Es una sola observación, sin simulación de red móvil ni
medición de dispersión; no garantiza ese tiempo en otros equipos.

El render detallado tiene un costo apreciable en GPU integrada. Auto conserva
modelos, materiales y sombras, y omite la oclusión ambiental adicional en GPU
integrada, móvil o no identificada. Alta la activa. El alcance visible es de
700 m en escritorio y 450 m en móvil, con niebla progresiva; el mapa completo
sigue disponible para desplazarse y viajar. No se afirma una tasa garantizada
de fotogramas ni se han probado teléfonos físicos.

## Reproducir

```sh
npm ci
npm test
npm run build
python3 unreal/NeivaAbierta/Scripts/asset_plan.py --check
python3 -m unittest discover -s unreal/NeivaAbierta/Scripts/tests -v
```

Con `dist/` servido en el puerto 4173:

```sh
node scripts/check-browser.mjs
```

Contra el deployment público:

```sh
GAME_TEST_URL=https://neiva-abierta.vercel.app node scripts/check-browser.mjs
```

El script escribe capturas y resultados en `artifacts/`, excluido de Git.
Necesita Chrome y un servidor gráfico; `HEADLESS=1` permite una alternativa
para funcionalidad, cuyo render por software puede ser mucho más lento.
Estas comprobaciones no certifican una build Unreal ni una réplica exacta de
cada barrio, fachada o interior.
