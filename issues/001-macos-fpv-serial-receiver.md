# Issue 001

## Title
Receive FPV radio data from a Radiomaster transmitter over macOS USB serial

## Problem
Windows USB serial enumeration is failing for the transmitter, so we need a macOS-compatible receiver that can detect the radio as a USB serial device and start reading raw data from it.

## Goal
- Detect likely transmitter serial ports on macOS
- Allow manual port selection when needed
- Open the serial stream with a configurable baud rate
- Print received data in a useful format for debugging
