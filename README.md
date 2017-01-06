# What is it?

This is an attempt to apply the well-known MVP design pattern
to functional-reactive programming. The FRP library used is
[Cycle.js](https://github.com/cyclejs/cyclejs).

# Background

MVP is very useful in that it allows to untangle complex
interactions between the view (say, your widget library of choice)
and the application logic (that is, your procedural processing code).

Last time I tried this with Ur/Web-style reactive programming, I quickly got
stuck with fix-points: you need event streams (obtained from controls) to implement
processing logic, but that requires you to create the controls; and controls, in turn, will
most usually depend on processing logic for transforming event streams into
something useful. I don't remember the exact details, though.