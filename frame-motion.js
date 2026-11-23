"use strict";

const frameWidth = 400;
const frameHeight = 600;
const loopDuration = 5;
const fullCircle = 2 * Math.PI;

function glow(context, x, y, radius, rgb, opacity) {
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${rgb}, ${opacity})`);
    gradient.addColorStop(0.26, `rgba(${rgb}, ${opacity * 0.5})`);
    gradient.addColorStop(1, `rgba(${rgb}, 0)`);
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function trackPoint(track, progress) {
    const offset = Math.max(0, Math.min(1, progress)) * (track.length - 1);
    const index = Math.min(Math.floor(offset), track.length - 2);
    const mix = offset - index;
    return [
        track[index][0] + (track[index + 1][0] - track[index][0]) * mix,
        track[index][1] + (track[index + 1][1] - track[index][1]) * mix,
    ];
}

function arcGlow(context, track, progress, color, intensity, count = 11) {
    for (let index = count - 1; index >= 0; index -= 1) {
        const location = progress - index * 0.013;
        if (location < 0 || location > 1) continue;
        const [x, y] = trackPoint(track, location);
        const fade = 1 - index / count;
        glow(context, x, y, 4 + 10 * fade, color, intensity * fade * 0.85);
        if (index < 3) {
            glow(context, x, y, 3, "255, 252, 224", intensity * fade * 0.65);
        }
    }
}

function sparkle(context, x, y, size, color, opacity) {
    context.save();
    context.translate(x, y);
    context.globalAlpha = opacity;
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(0, -size);
    context.quadraticCurveTo(size * 0.12, -size * 0.12, size * 0.7, 0);
    context.quadraticCurveTo(size * 0.12, size * 0.12, 0, size);
    context.quadraticCurveTo(-size * 0.12, size * 0.12, -size * 0.7, 0);
    context.quadraticCurveTo(-size * 0.12, -size * 0.12, 0, -size);
    context.fill();
    context.restore();
}

const alchemyTubes = [
    [[63, 479], [47, 414], [48, 399], [50, 369], [48, 303], [48, 235], [49, 178], [58, 147], [67, 137]],
    [[330, 478], [349, 444], [350, 394], [350, 341], [350, 285], [350, 234], [354, 180], [343, 153]],
];

function animateAlchemy(context, position) {
    const angle = position * fullCircle;
    const colors = ["151, 255, 100", "255, 209, 96"];
    context.save();
    context.globalCompositeOperation = "source-atop";
    for (let index = 0; index < alchemyTubes.length; index += 1) {
        const track = alchemyTubes[index];
        const color = colors[index];
        for (let bubble = 0; bubble < 8; bubble += 1) {
            const progress = (position * 2 + bubble / 8 + index * 0.23) % 1;
            const [x, y] = trackPoint(track, progress);
            const wobble = Math.sin(angle * 3 + bubble * 2) * 3;
            const radius = 1.3 + (bubble % 3) * 0.9;
            glow(context, x + wobble, y, radius * 4, color, 0.63);
            context.strokeStyle = `rgba(${color}, 0.83)`;
            context.lineWidth = 0.9;
            context.beginPath();
            context.ellipse(x + wobble, y, radius, radius * 1.3, 0, 0, fullCircle);
            context.stroke();
        }
        arcGlow(context, track, (position * 2 + index * 0.45) % 1, color, 0.97);
    }
    const reservoir = 0.58 + 0.29 * Math.sin(angle * 2);
    glow(context, 66, 478, 47, colors[0], reservoir);
    glow(context, 336, 109, 32, colors[1], 1.12 - reservoir);
    context.restore();

    sparkle(context, 66, 480, 10, "#e8ffca", Math.pow(Math.max(0, Math.sin(angle * 2)), 5));
    sparkle(context, 336, 109, 8, "#fff1c3", Math.pow(Math.max(0, -Math.sin(angle * 2)), 5));
}

const mirrorShards = [
    { x: 38, y: 101, size: 13, offset: 0.02, outline: [[62, 58], [46, 111], [16, 144], [32, 87]] },
    { x: 364, y: 221, size: 12, offset: 0.29, outline: [[372, 183], [378, 217], [353, 261], [355, 206]] },
    { x: 353, y: 397, size: 10, offset: 0.58, outline: [[363, 362], [361, 405], [343, 431], [342, 387]] },
];

function shardPath(context, shard) {
    context.beginPath();
    context.moveTo(...shard.outline[0]);
    for (const vertex of shard.outline.slice(1)) context.lineTo(...vertex);
    context.closePath();
}

function drawShard(context, image, shard, position) {
    const angle = (position + shard.offset) * fullCircle;
    const flicker = Math.pow(Math.max(0, Math.sin(angle * 2)), 5);
    const x = shard.x + 5 * Math.cos(angle);
    const y = shard.y + 9 * Math.sin(angle);
    const size = shard.size;

    context.save();
    context.translate(x, y);
    context.rotate(Math.sin(angle) * 0.22);
    context.scale(0.52 + 0.48 * Math.abs(Math.cos(angle)), 1);
    context.translate(-shard.x, -shard.y);
    shardPath(context, shard);
    context.clip();
    context.drawImage(image, 0, 0, frameWidth, frameHeight);
    context.restore();
    glow(context, x, y, size * 1.8, "174, 147, 255", flicker * 0.29);
    sparkle(context, x, y, size * 1.08, "#fff2ff", flicker * 0.88);
}

function animateMirror(context, position, image) {
    context.save();
    context.globalCompositeOperation = "destination-out";
    context.fillStyle = "#000";
    for (const shard of mirrorShards) {
        shardPath(context, shard);
        context.fill();
    }
    context.restore();

    context.save();
    context.globalCompositeOperation = "source-atop";
    const sweep = position * 820 - 180;
    for (let index = 0; index < 2; index += 1) {
        const offset = sweep - index * 135;
        const light = context.createLinearGradient(offset - 53, 245, offset + 53, 305);
        light.addColorStop(0, "rgba(150, 119, 249, 0)");
        light.addColorStop(0.37, "rgba(148, 128, 250, 0.22)");
        light.addColorStop(0.47, "rgba(240, 183, 255, 0.55)");
        light.addColorStop(0.51, "rgba(234, 241, 255, 0.86)");
        light.addColorStop(0.65, "rgba(130, 190, 248, 0.27)");
        light.addColorStop(1, "rgba(145, 145, 249, 0)");
        context.fillStyle = light;
        context.fillRect(0, 0, frameWidth, frameHeight);
    }
    context.restore();

    for (const shard of mirrorShards) drawShard(context, image, shard, position);
}

const titanCore = [201, 537];
const titanSeams = [
    [titanCore, [153, 538], [106, 522], [53, 461], [47, 402], [42, 335], [44, 277], [38, 211], [61, 167], [65, 117], [84, 74], [146, 62]],
    [titanCore, [250, 541], [287, 517], [331, 471], [345, 431], [362, 374], [356, 328], [358, 264], [351, 215], [339, 158], [335, 112], [319, 79], [267, 62]],
];

function animateTitan(context, position) {
    const phase = (position * 2) % 1;
    const heartbeat = Math.exp(-Math.pow((phase - 0.13) / 0.049, 2))
        + 0.58 * Math.exp(-Math.pow((phase - 0.31) / 0.066, 2));
    const pulse = (phase - 0.1) * 1.4;
    const [coreX, coreY] = titanCore;
    context.save();
    context.globalCompositeOperation = "source-atop";
    glow(context, coreX, coreY, 44 + 25 * heartbeat, "255, 88, 29", 0.19 + 0.77 * heartbeat);
    glow(context, coreX, coreY, 19, "255, 213, 146", 0.74 * heartbeat);
    for (const seam of titanSeams) {
        arcGlow(context, seam, pulse, "255, 97, 31", 1, 15);
        arcGlow(context, seam, pulse - 0.28, "252, 159, 71", 0.47, 10);
    }
    context.restore();

    const wave = (phase - 0.2) * 1.6;
    if (wave > 0 && wave < 1) {
        context.save();
        context.strokeStyle = `rgba(255, 144, 68, ${0.54 * (1 - wave) ** 2})`;
        context.lineWidth = 1.6;
        context.beginPath();
        context.ellipse(coreX, coreY, 17 + wave * 157, 12 + wave * 32, 0, 0, fullCircle);
        context.stroke();
        context.restore();
    }
    for (let index = 0; index < 13; index += 1) {
        const travel = (phase + index * 0.137) % 1;
        const direction = index % 2 ? -1 : 1;
        const x = coreX + direction * (19 + travel * (75 + index * 4));
        const y = coreY + 9 - travel * (14 + (index % 4) * 8);
        const opacity = Math.sin(travel * Math.PI) * 0.78;
        glow(context, x, y, 4.7, "255, 103, 27", opacity);
        context.fillStyle = `rgba(255, 195, 111, ${opacity})`;
        context.fillRect(x, y, 1.2 + (index % 3) * 0.36, 1.3);
    }
}

const animations = {
    "aether-lab": animateAlchemy,
    "world-mirror": animateMirror,
    "titan-heart": animateTitan,
};

function renderFrame(context, image, id, seconds, badgeBox) {
    const position = (seconds % loopDuration) / loopDuration;
    context.clearRect(0, 0, frameWidth, frameHeight);
    context.drawImage(image, 0, 0, frameWidth, frameHeight);
    animations[id](context, position, image);
    // The card renderer already drew these labels over the static frame.
    if (badgeBox) {
        const [left, top, right, bottom] = badgeBox;
        context.clearRect(left, top, right - left + 1, bottom - top + 1);
    } else {
        context.clearRect(68, 0, 264, 59);
    }
    if (id === "titan-heart") context.clearRect(62, 450, 276, 45);
    else context.clearRect(38, 484, 324, 86);
    context.clearRect(165, 577, 70, 23);
}

const images = new Map();
const canvases = new WeakMap();
const visible = new Set();
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let animationRequest = 0;
let lastDraw = 0;

function syncAnimation() {
    if (document.hidden || reducedMotion.matches || !visible.size) {
        cancelAnimationFrame(animationRequest);
        animationRequest = 0;
    } else if (!animationRequest) {
        animationRequest = requestAnimationFrame(tick);
    }
}

function tick(time) {
    animationRequest = 0;
    if (time - lastDraw >= 1000 / 24) {
        lastDraw = time;
        for (const canvas of visible) {
            if (!canvas.isConnected) {
                observer.unobserve(canvas);
                visible.delete(canvas);
                continue;
            }
            const { context, image, id, badgeBox } = canvases.get(canvas);
            renderFrame(context, image, id, time / 1000, badgeBox);
        }
    }
    syncAnimation();
}

const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
        if (isIntersecting && target.isConnected) {
            visible.add(target);
        } else {
            visible.delete(target);
            if (!target.isConnected) observer.unobserve(target);
        }
    }
    syncAnimation();
});

document.addEventListener("visibilitychange", syncAnimation);
reducedMotion.addEventListener("change", syncAnimation);

export async function mountFrameMotion(container, id, url, badgeBox) {
    if (!Object.hasOwn(animations, id)) return;
    if (!images.has(url)) {
        const image = new Image();
        image.src = url;
        images.set(url, image.decode().then(() => image).catch((error) => {
            images.delete(url);
            throw error;
        }));
    }
    const image = await images.get(url);
    if (!container.isConnected) return;
    const canvas = document.createElement("canvas");
    canvas.width = frameWidth;
    canvas.height = frameHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    canvases.set(canvas, { context, image, id, badgeBox });
    renderFrame(context, image, id, 0, badgeBox);
    container.append(canvas);
    observer.observe(canvas);
}
