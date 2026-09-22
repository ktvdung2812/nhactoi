#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [[ -z "${JAVA_HOME:-}" ]] && [[ "$(uname)" == "Darwin" ]]; then
  export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
fi
: "${JAVA_HOME:?Set JAVA_HOME to a JDK 17 installation}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
npx expo prebuild --platform android --no-install
cd android
./gradlew assembleDebug --no-daemon "$@"
