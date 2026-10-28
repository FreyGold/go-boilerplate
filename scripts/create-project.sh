#!/usr/bin/env bash
set -euo pipefail

usage='Usage: bash create-project.sh <name> [--module <module-path>]'

if [[ $# -eq 1 && ( $1 == --help || $1 == -h ) ]]; then
  printf '%s\n' "$usage"
  exit 0
fi

if [[ $# -ne 1 && ! ( $# -eq 3 && $2 == --module ) ]]; then
  printf 'Error: %s\n' "$usage" >&2
  exit 1
fi

name=$1
if [[ ! $name =~ ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ ]] || (( ${#name} > 63 )); then
  printf '%s\n' 'Error: The name must start with a lowercase letter and contain at most 63 lowercase letters, digits, or single hyphens.' >&2
  exit 1
fi

for command in git node tar; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Error: %s is required.\n' "$command" >&2
    exit 1
  fi
done

destination="./$name"
if [[ -e $destination || -L $destination ]]; then
  printf 'Error: %s already exists.\n' "$destination" >&2
  exit 1
fi

temp_dir=$(mktemp -d "${TMPDIR:-/tmp}/go-template.XXXXXXXXXX")
created_destination=false
cleanup() {
  if [[ $created_destination == true ]]; then
    rm -rf -- "$destination"
  fi
  rm -rf -- "$temp_dir"
}
trap cleanup EXIT

printf 'Downloading the template...\n'
git clone --quiet --depth 1 --branch main -- \
  'https://github.com/FreyGold/go-boilerplate.git' "$temp_dir/template" </dev/null
mkdir -- "$temp_dir/project"
git -C "$temp_dir/template" archive HEAD | tar -xf - -C "$temp_dir/project"

node "$temp_dir/project/scripts/init-project.mjs" "$@"

mkdir -- "$destination"
created_destination=true
cp -R -- "$temp_dir/project/." "$destination/"
created_destination=false

printf 'Created %s\n' "$destination"
