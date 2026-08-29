#!/bin/bash
# Builda a versão de produção (release, sem dev server embutido) e instala
# direto no iPhone de teste físico, sem passar pelo fluxo de distribuição
# Ad Hoc (que exige conta Apple Developer paga) — docs/31, docs/33.
#
# Uso (rodar direto no Terminal.app do Mac — ver aviso abaixo):
#   ./ios-deploy-device.sh                        # usa "My iPhone"
#   ./ios-deploy-device.sh --device "outro nome"
#   ./ios-deploy-device.sh --setup-keychain       # autorização única, ver embaixo
#
# PRECISA RODAR NO TERMINAL.APP LOCAL DO MAC, NÃO VIA SSH — a menos que
# `--setup-keychain` já tenha sido rodado uma vez antes. Descoberto na prática
# (2026-08-29, 3 sessões seguidas até consolidar isso): a etapa de `codesign`
# de verdade precisa do Keychain da sessão gráfica; via SSH ela falha com
# `errSecInternalComponent` mesmo com o certificado certo instalado. Rodar
# `--setup-keychain` uma vez (localmente) resolve isso de vez, autorizando o
# `codesign` a usar a chave sem prompt interativo — depois disso este script
# também funciona via SSH.
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
  echo "Autorizando codesign a usar a chave de assinatura sem sessão gráfica."
  echo "Isso muda a política de acesso da chave no login keychain (mesmo mecanismo"
  echo "que ferramentas tipo Fastlane usam em CI) — rode só uma vez; o macOS deve"
  echo "pedir sua senha de login em seguida."
  keychain="$(security default-keychain | tr -d ' "')"
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s "$keychain"
  echo "Pronto — não precisa repetir isso a cada deploy."
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
  echo "codesign falhou por falta de acesso ao Keychain da sessão gráfica."
  echo "Rode este script direto no Terminal.app do Mac (não via SSH), ou rode"
  echo "'$0 --setup-keychain' uma vez pra liberar isso permanentemente."
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
built_products_dir="$(echo "$build_settings" | grep -m1 'BUILT_PRODUCTS_DIR' | sed 's/.*= //')"
full_product_name="$(echo "$build_settings" | grep -m1 'FULL_PRODUCT_NAME' | sed 's/.*= //')"
bundle_id="$(echo "$build_settings" | grep -m1 'PRODUCT_BUNDLE_IDENTIFIER' | sed 's/.*= //')"
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
