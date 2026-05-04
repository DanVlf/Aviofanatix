## Issue 004

Předělat ČHMÚ srážkový panel na radarový nowcast.

### Cíl

- místo prostého hodinového srážkového souhrnu zobrazit radar "teď"
- přidat krátký radarový výhled z oficiálních ČHMÚ dat
- dát uživateli rychlou odpověď, jestli se srážky blíží nebo ne

### Hotovo bude když

- backend vrátí aktuální radarový snímek a dostupný forecast frame
- frontend zobrazí panel s live radarem a stručným stavem
- panel nebude padat na HTML odpovědi místo JSON
