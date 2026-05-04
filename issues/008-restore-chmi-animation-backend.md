## Issue 008

Obnovit backend pro ČHMÚ radarovou animaci, aby nový clone projektu znovu vracel posledních 10 frameů místo jediného obrázku.

### Cíl

- vracet z backendu aktuální `MAX_Z` radarový snímek i historii posledních 10 unikátních frameů
- zpřístupnit jednotlivé frame PNG přes backend route
- sladit backend s frontendem, který už animaci umí přehrávat

### Hotovo bude když

- `/api/chmi/precipitation` vrátí pole `frames`
- backend deduplikuje duplicitní filenames z ČHMÚ indexu
- `/api/chmi/precipitation/frame/<filename>` vrátí konkrétní radarový frame
