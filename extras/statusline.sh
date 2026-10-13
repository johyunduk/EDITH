#!/bin/sh
input=$(cat)

# ANSI codes
RESET="\033[0m"
DIM="\033[37m"
GREEN="\033[1;92m"
YELLOW="\033[1;93m"
RED="\033[1;91m"

# Pick ANSI color based on percentage
ansi_color() {
  val_int=$(printf "%.0f" "$1")
  if [ "$val_int" -ge 80 ]; then
    printf "%s" "$RED"
  elif [ "$val_int" -ge 50 ]; then
    printf "%s" "$YELLOW"
  else
    printf "%s" "$GREEN"
  fi
}

# Build colored label: first N chars in color, rest dimmed
# Usage: colored_label LABEL percentage
colored_label() {
  label="$1"
  pct="$2"
  len=${#label}
  filled=$(printf "%.0f" "$(echo "$pct * $len / 100" | bc -l)")
  color=$(ansi_color "$pct")

  result=""
  i=1
  while [ $i -le $len ]; do
    ch=$(printf "%s" "$label" | cut -c$i)
    if [ $i -le $filled ]; then
      result="${result}${color}${ch}${RESET}"
    else
      result="${result}${DIM}${ch}${RESET}"
    fi
    i=$((i + 1))
  done
  printf "%s" "$result"
}

# Format seconds into "XhXXm"
fmt_hm() {
  secs="$1"
  now=$(date +%s)
  diff=$((secs - now))
  if [ "$diff" -le 0 ]; then
    echo "now"
    return
  fi
  h=$((diff / 3600))
  m=$(( (diff % 3600) / 60 ))
  printf "%dh%02dm" "$h" "$m"
}

# Format seconds into "XdXh"
fmt_dh() {
  secs="$1"
  now=$(date +%s)
  diff=$((secs - now))
  if [ "$diff" -le 0 ]; then
    echo "now"
    return
  fi
  d=$((diff / 86400))
  h=$(( (diff % 86400) / 3600 ))
  printf "%dd%dh" "$d" "$h"
}

# Read JSON fields
model=$(echo "$input" | jq -r '.model.display_name // empty')
effort=$(echo "$input" | jq -r '.effort.level // empty')
if [ -z "$effort" ]; then
  # Fallback: stdin has no effort field for this model, read configured effort from settings.json
  model_id=$(echo "$input" | jq -r '.model.id // empty')
  settings_file="$HOME/.claude/settings.json"
  if [ -f "$settings_file" ]; then
    effort=$(jq -r --arg mid "$model_id" '(.modelSettings[$mid].effortLevel // .effortLevel // empty)' "$settings_file" 2>/dev/null)
  fi
fi
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
five_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
week_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
five_resets=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
week_resets=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

parts=""

# Model
if [ -n "$model" ]; then
  case "$model" in
    *opus*|*Opus*) parts="✦ \033[1;95m${model}\033[0m" ;;
    *) parts="✦ $model" ;;
  esac
  if [ -n "$effort" ]; then
    parts="$parts ${DIM}[${effort}]${RESET}"
  fi
fi

# CONTEXT — always show if context_window exists (including 0%)
ctx_raw=$(echo "$input" | jq -r 'if .context_window != null then (.context_window.used_percentage // 0) else "missing" end')
if [ "$ctx_raw" != "missing" ]; then
  ctx_int=$(printf "%.0f" "$ctx_raw")
  ctx_label=$(colored_label "CONTEXT" "$ctx_int")
  ctx_color=$(ansi_color "$ctx_int")
  ctx_str="${ctx_label} ${ctx_color}${ctx_int}%${RESET}"
  if [ -n "$parts" ]; then
    parts="$parts  ·  $ctx_str"
  else
    parts="$ctx_str"
  fi
fi

# DAILY (5h)
if [ -n "$five_pct" ]; then
  five_int=$(printf "%.0f" "$five_pct")
  five_label=$(colored_label "DAILY" "$five_int")
  five_color=$(ansi_color "$five_int")
  five_str="${five_label} ${five_color}${five_int}%${RESET}"
  if [ -n "$five_resets" ]; then
    five_reset_fmt=$(fmt_hm "$five_resets")
    five_str="${five_str} | ${five_reset_fmt}"
  fi
  if [ -n "$parts" ]; then
    parts="$parts  ·  $five_str"
  else
    parts="$five_str"
  fi
fi

# WEEKLY (7d)
if [ -n "$week_pct" ]; then
  week_int=$(printf "%.0f" "$week_pct")
  week_label=$(colored_label "WEEKLY" "$week_int")
  week_color=$(ansi_color "$week_int")
  week_str="${week_label} ${week_color}${week_int}%${RESET}"
  if [ -n "$week_resets" ]; then
    week_reset_fmt=$(fmt_dh "$week_resets")
    week_str="${week_str} | ${week_reset_fmt}"
  fi
  if [ -n "$parts" ]; then
    parts="$parts  ·  $week_str"
  else
    parts="$week_str"
  fi
fi

# Context warning
if [ "$ctx_raw" != "missing" ]; then
  ctx_warn_int=$(printf "%.0f" "$ctx_raw")
  if [ "$ctx_warn_int" -ge 60 ]; then
    parts="$parts\n\033[1;91m⚠ /compact or /clear\033[0m"
  fi
fi

printf "%b\n" "$parts"
