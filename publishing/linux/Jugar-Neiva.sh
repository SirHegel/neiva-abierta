#!/usr/bin/env bash
# Copyright (c) 2026 Jhon Steven Álvarez Ruiz. Original launcher: MIT.
set -euo pipefail

neiva_root=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
neiva_game="$neiva_root/Linux/NeivaAbierta.sh"

if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
    printf '%s\n' 'Este paquete requiere Linux x86_64.' >&2
    exit 64
fi
if [[ ! -x "$neiva_game" ]]; then
    printf '%s\n' 'Falta Linux/NeivaAbierta.sh o su permiso de ejecución. Extrae el paquete completo.' >&2
    exit 66
fi

neiva_gpu=${NEIVA_GPU:-auto}
case "$neiva_gpu" in
    auto|default) ;;
    *) printf '%s\n' 'NEIVA_GPU admite auto o default.' >&2; exit 64 ;;
esac

# NVIDIA documents these PRIME variables for a single application's process.
# Never change the session, compositor, display, installed driver or global env.
if [[ "$neiva_gpu" == auto ]] && command -v nvidia-smi >/dev/null 2>&1 \
    && command -v timeout >/dev/null 2>&1 \
    && timeout 5s nvidia-smi -L >/dev/null 2>&1; then
    exec env __NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia \
        __VK_LAYER_NV_optimus=NVIDIA_only "$neiva_game" -vulkan "$@"
fi

exec "$neiva_game" -vulkan "$@"
