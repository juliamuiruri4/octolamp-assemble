---
name: Octolamp Assemble
description: A dark GitHub-branded workbench around one wooden desk where the Octolamp kit is built in 3D.
colors:
  n-50: "#f2f5f3"
  n-300: "#b6bfb8"
  n-800: "#232925"
  n-900: "#101411"
  g-300: "#5fed83"
  g-500: "#0fbf3e"
  line: "#2f3631"
typography:
  display:
    fontFamily: "Mona Sans, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
rounded:
  tool: "10px"
  action: "12px"
  stage: "16px"
components:
  button-primary:
    backgroundColor: "{colors.g-500}"
    textColor: "{colors.n-900}"
    rounded: "{rounded.action}"
    height: "52px"
  button-tool:
    backgroundColor: "{colors.n-800}"
    textColor: "{colors.n-50}"
    rounded: "{rounded.tool}"
    height: "44px"
---

# Design system

## Overview

The lamp is the page. Dark neutral chrome, one wooden desk stage, one short instruction and one primary action. GitHub Green appears only on the primary action, progress and done marks. Hardware colors appear only on the product.

## Layout

Desktop: stage on the left, a 380px panel on the right. Mobile: stage on top, panel below, primary button in the first screen. The camera frames each step.

## Motion

Parts drop onto the desk, the strip chases its route, the lamp flips and settles into the Universe '26 box. `prefers-reduced-motion` makes every state change instant.

