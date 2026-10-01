#!/usr/bin/env bash
set -Eeuo pipefail

# Deploy one immutable release from the Git worktree used by aaPanel Git Manager.
# The script deliberately does not pull, print .env, migrate backwards, or
# delete old releases. Run it as root; npm/build work is delegated to www.

log() { printf '[nhactoi deploy] %s\n' "$*"; }
die() { printf '[nhactoi deploy] ERROR: %s\n' "$*" >&2; exit 1; }

[[ $# -eq 0 ]] || die 'usage: bash scripts/deploy-aapanel.sh'
[[ ${EUID:-$(id -u)} -eq 0 ]] || die 'run this hook as root; the build itself runs as www'

SITE_BASE=${AAPANEL_SITE_BASE:-/www/wwwroot/nhactoi.ktvdung.io.vn}
APP_ROOT=${AAPANEL_APP_ROOT:-$SITE_BASE/nhactoi}
SHARED_ROOT=${AAPANEL_SHARED_ROOT:-$SITE_BASE/shared}
CURRENT_LINK=${AAPANEL_CURRENT_LINK:-$SITE_BASE/current}
PREVIOUS_LINK=${AAPANEL_PREVIOUS_LINK:-$SITE_BASE/previous}
RELEASES_ROOT=${AAPANEL_RELEASES_ROOT:-$SHARED_ROOT/releases}
NPM_CACHE=${AAPANEL_NPM_CACHE:-$SHARED_ROOT/npm-cache}
ENV_FILE=${AAPANEL_ENV_FILE:-$SHARED_ROOT/.env}
LOCK_FILE=${AAPANEL_LOCK_FILE:-$SHARED_ROOT/deploy.lock}
RUN_USER=${AAPANEL_RUN_USER:-www}
PROJECT_NAME=${AAPANEL_PROJECT_NAME:-nhactoi}
PORT=${AAPANEL_PORT:-3100}
NODE_BIN_DIR=${AAPANEL_NODE_BIN:-/www/server/nodejs/v24.14.1/bin}
PANEL_DIR=${AAPANEL_PANEL_DIR:-/www/server/panel}
PANEL_PYTHON=${AAPANEL_PYTHON:-$PANEL_DIR/pyenv/bin/python}
NODE_MODEL=${AAPANEL_NODE_MODEL:-$PANEL_DIR/class_v2/projectModelV2/nodejsModel.py}
HEALTH_ATTEMPTS=${AAPANEL_HEALTH_ATTEMPTS:-30}
HEALTH_INTERVAL=${AAPANEL_HEALTH_INTERVAL:-2}

require_command() { command -v "$1" >/dev/null 2>&1 || die "missing command: $1"; }
for command_name in curl date flock git ln mv readlink runuser tar; do
  require_command "$command_name"
done

[[ -d "$APP_ROOT" ]] || die "source worktree is missing: $APP_ROOT"
[[ -f "$ENV_FILE" ]] || die "shared environment file is missing: $ENV_FILE"
[[ -x "$PANEL_PYTHON" ]] || die "aaPanel Python is missing: $PANEL_PYTHON"
[[ -f "$NODE_MODEL" ]] || die "aaPanel Node model is missing: $NODE_MODEL"
[[ -x "$NODE_BIN_DIR/npm" ]] || die "Node/npm is missing: $NODE_BIN_DIR/npm"
[[ "$PORT" =~ ^[0-9]+$ ]] || die 'AAPANEL_PORT must be numeric'
[[ "$HEALTH_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] || die 'AAPANEL_HEALTH_ATTEMPTS must be positive'
[[ "$HEALTH_INTERVAL" =~ ^[0-9]+$ ]] || die 'AAPANEL_HEALTH_INTERVAL must be numeric'
id "$RUN_USER" >/dev/null 2>&1 || die "runtime user is missing: $RUN_USER"

cd "$APP_ROOT"
source_git() { git -c "safe.directory=$APP_ROOT" "$@"; }
APP_ROOT_REAL=$(pwd -P)
GIT_ROOT=$(source_git rev-parse --show-toplevel 2>/dev/null) || die 'source directory is not a Git worktree'
GIT_ROOT_REAL=$(cd "$GIT_ROOT" && pwd -P)
[[ "$GIT_ROOT_REAL" == "$APP_ROOT_REAL" ]] || die "Git root is not $APP_ROOT_REAL"

RUN_GROUP=$(id -gn "$RUN_USER")
mkdir -p "$SHARED_ROOT/data" "$RELEASES_ROOT" "$NPM_CACHE"
chown "$RUN_USER:$RUN_GROUP" "$SHARED_ROOT/data" "$RELEASES_ROOT" "$NPM_CACHE"

exec 9>"$LOCK_FILE"
flock -x 9

COMMIT=$(source_git rev-parse --verify HEAD) || die 'cannot resolve HEAD'
STAMP=$(date -u +%Y%m%d%H%M%S)
RELEASE="$RELEASES_ROOT/${STAMP}-${COMMIT:0:12}"
[[ ! -e "$RELEASE" ]] || RELEASE="${RELEASE}-$$"

old_target=''
if [[ -L "$CURRENT_LINK" ]]; then
  old_target=$(readlink -f "$CURRENT_LINK")
  [[ -d "$old_target" ]] || die "current target is missing: $old_target"
  case "$old_target" in
    "$RELEASES_ROOT"/*) ;;
    *) die "current points outside releases: $old_target" ;
  esac
elif [[ -e "$CURRENT_LINK" ]]; then
  die "current exists but is not a symlink: $CURRENT_LINK"
fi
if [[ -e "$PREVIOUS_LINK" && ! -L "$PREVIOUS_LINK" ]]; then
  die "previous exists but is not a symlink: $PREVIOUS_LINK"
fi

mark_failed() {
  [[ -n "$RELEASE" && -d "$RELEASE" ]] || return 0
  : > "$RELEASE/.failed" 2>/dev/null || true
}
on_exit() {
  local status=$?
  (( status == 0 )) || mark_failed
  exit "$status"
}
trap on_exit EXIT

log "archiving commit ${COMMIT:0:12}"
mkdir -p "$RELEASE"
source_git archive --format=tar "$COMMIT" | tar -xf - -C "$RELEASE"
ln -s "$ENV_FILE" "$RELEASE/.env"
chown -R "$RUN_USER:$RUN_GROUP" "$RELEASE"

run_npm_as_www() {
  runuser -u "$RUN_USER" -- 9>&- env \
    "PATH=$NODE_BIN_DIR:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    npm_config_audit=false npm_config_fund=false npm_config_update_notifier=false \
    "npm_config_cache=$NPM_CACHE" \
    NHACTOI_DIST_DIR=.next \
    "$NODE_BIN_DIR/npm" --prefix "$RELEASE" "$@"
}

log 'installing production dependencies as www'
if ! run_npm_as_www ci --omit=dev; then
  die 'npm ci failed; active release was left unchanged'
fi
if [[ -s "$RELEASE/.next/BUILD_ID" && -d "$RELEASE/.next/server" && -d "$RELEASE/.next/static" ]]; then
  log "using prebuilt Next.js output $(tr -d '[:space:]' < "$RELEASE/.next/BUILD_ID")"
else
  log 'building the production release as www'
  if ! run_npm_as_www run build:server; then
    die 'production build failed; active release was left unchanged'
  fi
fi

atomic_link() {
  local target=$1
  local link=$2
  local tmp="${link}.next.$$"
  rm -f "$tmp"
  ln -s "$target" "$tmp"
  mv -Tf "$tmp" "$link"
}

configure_panel_start() {
  # aaPanel puts node_modules/.bin first on PATH. A startup value of "next"
  # becomes `nohup next`, which execs the shim and fails with EACCES when /www
  # is noexec. "start" is an npm script, so the panel runs npm instead.
  "$PANEL_PYTHON" - "$PROJECT_NAME" "$CURRENT_LINK" "$PORT" "$PANEL_DIR" "$NODE_MODEL" 9>&- <<'PY'
import json
import os
import sys
from contextlib import nullcontext

project_name, project_path, port, panel_dir, model_path = sys.argv[1:]
if not os.path.isfile(model_path):
    raise SystemExit("aaPanel Node model is missing")
os.chdir(panel_dir)
sys.path[:0] = ["class", "class_v2"]
from BTPanel import app  # noqa: E402
import public  # noqa: E402
from projectModelV2.nodejsModel import main  # noqa: E402

context = app.test_request_context("/") if hasattr(app, "test_request_context") else nullcontext()
with context:
    project = main().get_project_find(project_name)
if not project:
    raise SystemExit("aaPanel Node project is missing")
config = project["project_config"]
previous = config.get("project_script")
config["project_script"] = "start"
config["port"] = int(port)
config["project_cwd"] = project_path
public.M("sites").where("name=?", (project_name,)).update({
    "path": project_path,
    "project_config": json.dumps(config),
})
print("aaPanel startup script: %s -> start, port %s" % (previous, port))
PY
}

panel_action() {
  local action=$1
  "$PANEL_PYTHON" - "$PROJECT_NAME" "$action" "$PANEL_DIR" "$NODE_MODEL" 9>&- <<'PY'
import os
import sys
from contextlib import nullcontext

project_name, action, panel_dir, model_path = sys.argv[1:]
if action not in {"start_project", "restart_project", "stop_project"}:
    raise SystemExit("unsupported aaPanel action")
if not os.path.isfile(model_path):
    raise SystemExit("aaPanel Node model is missing")
os.chdir(panel_dir)
sys.path[:0] = ["class", "class_v2"]
from BTPanel import app  # noqa: E402
import public  # noqa: E402
from projectModelV2.nodejsModel import main  # noqa: E402

args = public.dict_obj()
args.project_name = project_name
context = app.test_request_context("/") if hasattr(app, "test_request_context") else nullcontext()
with context:
    result = getattr(main(), action)(args)
if isinstance(result, dict):
    status = result.get("status")
    message = result.get("message")
    if status is False or status == -1 or (isinstance(message, dict) and message.get("status") is False):
        raise SystemExit(1)
PY
}

start_or_restart() {
  if [[ -z "$old_target" ]]; then
    panel_action start_project
    return
  fi
  if panel_action restart_project; then
    return
  fi
  # aaPanel reports an error when restart_project first tries to stop an
  # already-stopped project. start_project is the safe initial-state fallback.
  log 'restart_project did not start the project; trying start_project'
  panel_action start_project
}

health_check() {
  curl --fail --silent --show-error --max-time 5 --output /dev/null "http://127.0.0.1:${PORT}/" &&
    curl --fail --silent --show-error --max-time 5 --output /dev/null "http://127.0.0.1:${PORT}/api/auth/google/config"
}

wait_health() {
  local attempt
  for ((attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt += 1)); do
    if health_check; then
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

rollback() {
  log 'rolling back the current symlink'
  if [[ -n "$old_target" ]]; then
    atomic_link "$old_target" "$CURRENT_LINK" || return 1
    if ! panel_action restart_project; then
      panel_action start_project || return 1
    fi
    wait_health
    return $?
  fi
  rm -f "$CURRENT_LINK"
  panel_action stop_project || true
  return 0
}

log 'switching current to the built release'
atomic_link "$RELEASE" "$CURRENT_LINK"
log 'pointing aaPanel at npm start'
if ! configure_panel_start; then
  rollback || true
  die 'could not set the aaPanel startup script to start; previous release restored when possible'
fi
if start_or_restart && wait_health; then
  if [[ -n "$old_target" ]]; then
    atomic_link "$old_target" "$PREVIOUS_LINK"
  fi
  log 'deployment is healthy'
  RELEASE=''
  exit 0
fi

if rollback; then
  if [[ -n "$old_target" ]]; then
    die 'new release failed startup or health checks; previous release restored'
  fi
  die 'new release failed startup or health checks; no previous release existed'
fi
die 'new release failed and rollback health check also failed; inspect aaPanel logs'
