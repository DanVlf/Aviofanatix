# Issue 009

## Title
Improve telemetry accuracy, battery semantics, and flight path visualization

## Problem
Several telemetry values in the dashboard are currently misleading or incomplete. GPS latitude and longitude are rounded too aggressively, groundspeed is scaled incorrectly, battery information does not reflect the intended 12.6V / 850mAh model, and yaw updates do not affect the 3D drone model as expected. The dashboard is also missing a flight path map and still includes a frame activity panel that is no longer useful.

## Goal
- Show GPS latitude and longitude with at least 6 decimal places
- Fix groundspeed scaling so the displayed speed matches the real km/h value
- Base the battery primary indicator on voltage, with 12.6V as 100%, and use 850mAh as the maximum capacity
- Make yaw updates rotate the 3D drone model correctly
- Derive vertical speed from altitude change over time and show it in the GPS panel
- Add a new resizable OpenStreetMap flight path component that draws the traveled line
- Remove the frame activity component from the dashboard

## Done When
- GPS coordinates render with 6 decimal places in the UI
- Displayed groundspeed is no longer off by a factor of ten
- Battery percentage and capacity semantics match the 12.6V / 850mAh model
- Yaw changes visibly rotate the 3D model
- The GPS panel shows vertical speed in English
- A new flight path panel renders the route over OpenStreetMap
- The frame activity panel is removed from the dashboard
