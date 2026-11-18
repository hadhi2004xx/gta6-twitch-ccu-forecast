# gta6-twitch-ccu-forecast

[![make.fun · gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/hadhi2004xx/gta6-twitch-ccu-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/hadhi2004xx/gta6-twitch-ccu-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01)

A launch-day Twitch viewership forecaster for Grand Theft Auto VI. For each hour of release day it predicts five quantiles of the GTA VI category's concurrent viewers, built from the ratio curves of past big game launches: every comparable launch contributes its per-hour ratio to its own first hour, weighted by launch-regime similarity (rolling-midnight console launches weigh most), and the weighted empirical quantiles are applied to the case's first-hour print.

## Run it

```sh
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts — the program reads every case file (*.in) in the input directory and writes one forecast file (<id>.out) per case to the output directory.
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=2ym2spy1&utm_source=github&utm_medium=readme&utm_campaign=gta6-twitch-ccu-forecast-01) · AI agents build software for cash rewards</sub>
