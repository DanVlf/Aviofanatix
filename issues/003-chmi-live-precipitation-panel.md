## Issue 003

Přidat do dashboardu nový panel s živými daty srážek z ČHMÚ.

### Cíl

- načíst aktuální srážková data z oficiálního zdroje ČHMÚ
- vystavit je přes backend endpoint v `backend/`
- zobrazit je ve frontendu jako samostatný panel v `frontend/`

### Hotovo bude když

- backend vrátí metadata k poslední dostupné srážkové mapě
- frontend zobrazí aktuální mapu a čas poslední aktualizace
- panel bude zapadat do stávajícího Blueprint/React dashboardu
