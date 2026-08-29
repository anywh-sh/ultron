#!/bin/bash
# Builda a versão de produção (release, sem dev server embutido) e instala
# direto no iPhone de teste físico, sem passar pelo fluxo de distribuição
# Ad Hoc (que exige conta Apple Developer paga) — docs/31, docs/33.
#
# Uso (rodar direto no Terminal.app do Mac, NUNCA via SSH — ver aviso abaixo):
#   ./ios-deploy-device.sh                        # usa "My iPhone"
#   ./ios-deploy-device.sh --device "outro nome"
#
# PRECISA RODAR NO TERMINAL.APP LOCAL DO MAC, NÃO VIA SSH. Descoberto na
# prática (2026-08-29): a etapa de `codesign` de verdade falha via SSH com
# `errSecInternalComponent`, e isso NÃO é uma questão de permissão da chave
# nem de keychain trancado — já tentamos `security set-key-partition-list`
# (autorização sem prompt, mecanismo que Fastlane/CI usam) e
# `security unlock-keychain` explícito, os dois "funcionaram" localmente sem
# erro nenhum, e o `codesign` via SSH continuou falhando igual logo depois.
# A causa é a sessão SSH em si não ter o contexto de sessão gráfica (Aqua/
# WindowServer) que essa operação exige — não tem escape hatch conhecido
# pra isso (ver docs/31 pro registro completo da investigação). `--setup-keychain`
# abaixo existe só porque já estava testado antes desse achado — não resolve
# o problema de rodar via SSH, mas não faz mal nenhum rodar mesmo assim.
#
# Outros dois erros já vistos, cobertos abaixo automaticamente ou com
# instrução clara:
# - `--export-method release-testing` (Ad Hoc) SEMPRE falha no passo final de
#   export com conta grátis ("does not have permission to create iOS Ad Hoc
#   provisioning profiles") — isso é esperado, não é bug. O `.app` já está
#   assinado antes desse passo, então instalamos ele direto do DerivedData do
#   Xcode, pulando o export.
# - `tauri ios init` (rodado automaticamente aqui se `gen/apple/` não
#   existir, ex: primeira vez ou depois de mudar um plugin nativo) apaga o
#   Team de assinatura selecionado manualmente no Xcode — isso só se resolve
#   reabrindo o Xcode e reselecionando o Team em Signing & Capabilities, não
#   dá pra automatizar via CLI (a conta Apple em si precisa estar logada no
#   Xcode, que é uma tela de login potencialmente com 2FA).

set -uo pipefail  # sem -e: o build "falha" (exit != 0) no caso esperado do Ad Hoc, tratamos isso pelo conteúdo do log, não pelo exit code

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DEVICE_NAME="My iPhone"
SETUP_KEYCHAIN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --device)
      DEVICE_NAME="$2"
      shift 2
      ;;
    --setup-keychain)
      SETUP_KEYCHAIN=true
      shift
      ;;
    *)
      echo "Argumento desconhecido: $1" >&2
      exit 1
      ;;
  esac
done

# Shell não-interativo (inclusive via SSH) não carrega .zshrc — sem isso nem
# `node`/`npm` (nvm) nem `xcodegen`/`pod` (homebrew) são encontrados.
export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:/opt/homebrew/bin:$PATH"

if $SETUP_KEYCHAIN; then
  echo "Autorizando codesign a usar a chave de assinatura sem prompt de permissão."
  echo "NÃO resolve rodar este script via SSH (testado 2026-08-29, ver docs/31) —"
  echo "isso continua exigindo Terminal.app local de qualquer forma. Só evita o"
  echo "prompt de 'permitir codesign usar esta chave' ao rodar localmente."
  keychain="$(security default-keychain | tr -d ' "')"
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s "$keychain"
  echo "Pronto."
  exit 0
fi

if [[ ! -d "$CLIENT_DIR/src-tauri/gen/apple" ]]; then
  echo "gen/apple/ não existe (normal entre sessões, é gitignored) — rodando tauri ios init..."
  (cd "$CLIENT_DIR" && npx tauri ios init)
  echo
  echo "ATENÇÃO: tauri ios init pode ter apagado o Team de assinatura configurado no Xcode."
  echo "Se o build abaixo falhar pedindo Team/conta, abre o Xcode"
  echo "(client/src-tauri/gen/apple/client.xcodeproj), target client_iOS ->"
  echo "Signing & Capabilities, e reseleciona o Team no dropdown antes de rodar de novo."
  echo
fi

log="$(mktemp -t ultron-ios-build)"
echo "Buildando (release, --export-method release-testing)... log completo em $log"
(cd "$CLIENT_DIR" && npx tauri ios build -t aarch64 --export-method release-testing) 2>&1 | tee "$log"

if grep -q "errSecInternalComponent" "$log"; then
  echo
  echo "codesign falhou por rodar fora da sessão gráfica — isso só acontece via SSH."
  echo "Não tem contorno conhecido (já tentamos set-key-partition-list e"
  echo "unlock-keychain, nenhum resolve — ver docs/31). Rode este script direto"
  echo "no Terminal.app do Mac."
  exit 1
fi

if grep -qE "No Account for Team|requires a development team" "$log"; then
  echo
  echo "Falta configurar a assinatura no Xcode:"
  echo "  1. Xcode.app -> Settings -> Accounts -> confirma/adiciona a conta Apple"
  echo "  2. Abre client/src-tauri/gen/apple/client.xcodeproj"
  echo "  3. Target client_iOS -> Signing & Capabilities -> 'Automatically manage"
  echo "     signing' marcado, e o Team certo selecionado no dropdown"
  echo "  4. Roda este script de novo"
  exit 1
fi

if grep -q "BUILD FAILED" "$log"; then
  if grep -q "does not have permission to create iOS Ad Hoc provisioning profiles" "$log"; then
    echo
    echo "Export Ad Hoc falhou como esperado (conta grátis não tem essa permissão)"
    echo "— o .app já foi assinado antes desse passo. Instalando ele direto, sem"
    echo "passar pelo export."
  else
    echo
    echo "Build falhou por um motivo ainda não catalogado neste script. Últimas linhas do log:"
    tail -60 "$log"
    exit 1
  fi
fi

cd "$CLIENT_DIR"
build_settings="$(xcodebuild -showBuildSettings -workspace src-tauri/gen/apple/client.xcodeproj/project.xcworkspace -scheme client_iOS -configuration release -sdk iphoneos 2>/dev/null)"
# Ancorado (^\s*CHAVE = ) — sem isso, `grep -m1 'PRODUCT_BUNDLE_IDENTIFIER'`
# pega `DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER = NO` primeiro (vem antes
# na saída do xcodebuild), e o script tentava lançar um app chamado "NO" —
# bug real encontrado testando contra o device de verdade.
built_products_dir="$(echo "$build_settings" | grep -m1 -E '^\s*BUILT_PRODUCTS_DIR = ' | sed 's/.*= //')"
full_product_name="$(echo "$build_settings" | grep -m1 -E '^\s*FULL_PRODUCT_NAME = ' | sed 's/.*= //')"
bundle_id="$(echo "$build_settings" | grep -m1 -E '^\s*PRODUCT_BUNDLE_IDENTIFIER = ' | sed 's/.*= //')"
app_path="$built_products_dir/$full_product_name"

if [[ ! -d "$app_path" ]]; then
  echo "Não achei o .app assinado em $app_path — o build passou por um caminho que este script não reconhece."
  exit 1
fi

devices_json="$(mktemp -t ultron-devices)"
xcrun devicectl list devices --json-output "$devices_json" >/dev/null
device_id="$(python3 -c "
import json
with open('$devices_json') as f:
    data = json.load(f)
for d in data['result']['devices']:
    if d['deviceProperties']['name'] == '$DEVICE_NAME':
        print(d['identifier'])
        break
")"

if [[ -z "$device_id" ]]; then
  echo "Não achei nenhum device chamado '$DEVICE_NAME' conectado agora. Devices disponíveis:"
  xcrun devicectl list devices
  exit 1
fi

echo "Instalando $full_product_name em $DEVICE_NAME ($device_id)..."
xcrun devicectl device install app --device "$device_id" "$app_path"
xcrun devicectl device process launch --device "$device_id" "$bundle_id"
echo "Pronto — $full_product_name instalado e aberto em $DEVICE_NAME."
