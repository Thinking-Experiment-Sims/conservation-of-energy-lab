# Conservation of Energy — Pendulum & Photogate Lab

Interactive physics lab tool for **The Thinking Experiment (PhysicsKit)** featuring two modes:

1. **Physical Lab Data Recorder (In-Class Helper):** Enter pendulum bob mass, initial drop height ($h_{\text{top}}$), photogate height ($h_{\text{bottom}}$), and photogate time ($\Delta t$) or velocity ($v$) for Points A–E. Automatically computes $PE$, $KE$, $TE$, $\Delta TE$, step-by-step sample calculations, and the $v^2$ vs. $\Delta h$ linearization graph.
2. **Virtual Pendulum Lab (Online Simulation):** Interactive 2D pendulum + photogate apparatus with draggable release height, adjustable photogate height, real-time photogate LCD timer ($\Delta t$ and $v = d/\Delta t$), live mechanical energy bars, and full lab report & linearization export.

## Tests

```sh
node --test tests/physics.test.js
```
