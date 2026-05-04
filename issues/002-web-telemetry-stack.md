# Issue 002

## Title
Build a local telemetry web app with Flask backend and React frontend

## Problem
Telemetry is available from the radio on macOS, but it is only visible in a terminal script. We need a backend service that reads and exposes telemetry data, and a frontend that renders it in a clearer live UI.

## Goal
- Create a `backend/` app with Flask and the telemetry reader logic
- Create a `frontend/` app with React, TypeScript, and Blueprint.js
- Expose telemetry data from the backend over HTTP
- Show live telemetry in the frontend on default local ports
