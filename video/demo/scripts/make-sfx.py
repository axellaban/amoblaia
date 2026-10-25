# Genera efectos de sonido simples (sin licencias de terceros): clic, swoosh, pop y brillo.
import math, random, struct, wave, sys, os
SR = 48000
out = sys.argv[1] if len(sys.argv) > 1 else "public/sfx"
os.makedirs(out, exist_ok=True)
random.seed(7)

def save(name, samples):
    peak = max(1e-9, max(abs(s) for s in samples))
    with wave.open(os.path.join(out, name), "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s / peak * 0.9)) * 32767)) for s in samples))

def lowpass(x, a):
    y, p = [], 0.0
    for s in x:
        p += a * (s - p); y.append(p)
    return y

# Clic de mouse: dos transitorios cortos (bajada y subida del botón).
def click():
    n = int(SR * 0.09); x = [0.0] * n
    for start, amp, f in [(0, 1.0, 3200), (int(SR * 0.045), 0.55, 2600)]:
        for i in range(int(SR * 0.012)):
            t = i / SR
            env = math.exp(-t * 900)
            x[start + i] += amp * env * (math.sin(2 * math.pi * f * t) * 0.6 + (random.random() * 2 - 1) * 0.5)
    return lowpass(x, 0.55)

# Swoosh: ruido filtrado con barrido y envolvente suave.
def whoosh(d=0.55):
    n = int(SR * d); y = []; p = 0.0
    for i in range(n):
        t = i / n
        a = 0.02 + 0.25 * math.sin(math.pi * t) ** 2
        p += a * ((random.random() * 2 - 1) - p)
        y.append(p * math.sin(math.pi * t) ** 1.5)
    return y

# Pop: seno con caída de tono.
def pop():
    n = int(SR * 0.12); y = []; ph = 0.0
    for i in range(n):
        t = i / SR
        f = 900 * math.exp(-t * 18) + 380
        ph += 2 * math.pi * f / SR
        y.append(math.sin(ph) * math.exp(-t * 32))
    return y

# Brillo: acorde ascendente suave (para «listo»).
def chime():
    n = int(SR * 0.9); y = [0.0] * n
    for k, (f, d) in enumerate([(1046.5, 0), (1318.5, 0.07), (1568.0, 0.14), (2093.0, 0.21)]):
        s0 = int(d * SR)
        for i in range(n - s0):
            t = i / SR
            y[s0 + i] += 0.25 * math.sin(2 * math.pi * f * t) * math.exp(-t * 5) * min(1, t * 200)
    return y

# Tecla: clic muy corto y suave.
def key():
    n = int(SR * 0.03); y = []
    for i in range(n):
        t = i / SR
        y.append((random.random() * 2 - 1) * math.exp(-t * 500) + 0.4 * math.sin(2 * math.pi * 1800 * t) * math.exp(-t * 700))
    return lowpass(y, 0.4)

save("click.wav", click())
save("whoosh.wav", whoosh())
save("pop.wav", pop())
save("chime.wav", chime())
save("key.wav", key())
print("ok")
