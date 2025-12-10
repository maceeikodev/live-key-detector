const noteNames = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const colors = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];
const camelotsA = ["05A","12A","07A","02A","09A","04A","11A","06A","01A","08A","03A","10A"];
const camelotsB = ["08B","03B","10B","05B","12B","07B","02B","09B","04B","11B","06B","01B"];

function freqToNoteName(freq) {
    const midi = Math.round(12 * Math.log2(freq / 440) + 69);
    const note = noteNames[midi % 12];
    const oct = Math.floor(midi / 12) - 1;
    return note + oct;
}

function freqToNote(freq) {
    const midi = 12 * Math.log2(freq / 440) + 69;
    return midi;
}

function getColorHue(note) {
    return (12 - ((colors[note] - 6) % 12)) * 30;
}

function drawPie(data) {
    const canvas = document.getElementById('pieChart');
    const ctx = canvas.getContext('2d');
    const total = data.reduce((a,b)=>a+b,0);

    let startAngle = 0;

    data.forEach((value, i) => {
        const sliceAngle = (value / total) * 2 * Math.PI;

        // Random color for each slice
        const color = `hsl(${getColorHue(i)}, 70%, 50%)`;
        ctx.fillStyle = color;

        // Draw slice
        ctx.beginPath();
        ctx.moveTo(canvas.width/2, canvas.height/2);
        ctx.arc(canvas.width/2, canvas.height/2, canvas.width/2, startAngle, startAngle + sliceAngle);
        ctx.closePath();
        ctx.fill();

        startAngle += sliceAngle;
    });

    startAngle = 0;
    data.forEach((value, i) => {
        const sliceAngle = (value / total) * 2 * Math.PI;

        const midAngle = startAngle + sliceAngle / 2;
        const zoom = 0.7;//(Math.sin(i) / 2 + 0.5) * 0.5 + 0.4;
        const labelX = canvas.width/2 + Math.cos(midAngle) * (canvas.width/2 * zoom);
        const labelY = canvas.height/2 + Math.sin(midAngle) * (canvas.height/2 * zoom);

        ctx.fillStyle = '#fff';
        ctx.font = '14px Rubik';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if ((value / total) > 0.05) ctx.fillText(noteNames[i], labelX, labelY);

        startAngle += sliceAngle;
    });
}

async function start(micOrDisplay) {
    document.getElementById("corebody").style.display = "flex";
    document.getElementById("startscr").style.display = "none";

    const canvas = document.getElementById('canvas').getContext('2d');
    canvas.fillStyle = 'black';
    const cw = 600;
    const ch = 300;
    canvas.fillRect(0,0,cw,ch);

    const canvas_history = document.getElementById('canvas_notehistory').getContext('2d');

    //return;

    const stream = micOrDisplay ? await navigator.mediaDevices.getUserMedia({ audio:true }) : await navigator.mediaDevices.getDisplayMedia({audio:true,video:true});
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2 * 4096;
    analyser.smoothingTimeConstant = 0.5;

    src.connect(analyser);

    const N = analyser.fftSize;
    const binWidth = ctx.sampleRate / N;

    let mag = new Float32Array(analyser.frequencyBinCount);
    let lin = new Float32Array(analyser.frequencyBinCount);
    let noteHistory = new Float32Array(1000);
    let noteCursor = 0;

    let lastNote = 0;

    function loop() {
        analyser.getFloatFrequencyData(mag);

        canvas.fillStyle = 'white';
        canvas.fillRect(0,0,cw,ch);

        canvas.strokeStyle = `hsl(${getColorHue(11)}, 70%, 50%)`;
        canvas.beginPath();

        const fLimitLower = Math.floor(30 / binWidth); // 30Hz
        const fLimitUpper = Math.floor(200 / binWidth); // 200Hz

        // convert dB to linear magnitude
        for (let i = 0; i < mag.length; i++) {
            let boost = i / fLimitUpper;
            if (boost > 1) boost = 1;
            boost = 1 - boost;
            /*boost /= 2;
            boost += 1/2;*/
            lin[i] = Math.pow(10, mag[i] / 20) * boost;

            if (i <= fLimitUpper) {
                let y = ch - ((20*Math.log10(lin[i]))+100)/100 * ch; // normalize
                if(i===0) canvas.moveTo(i*(cw / fLimitUpper),y);
                else canvas.lineTo(i*(cw / fLimitUpper),y);
            }
        }
        canvas.stroke();

        // HPS CLONE
        const hps = new Float32Array(lin.length);
        for (let i = 0; i < hps.length; i++) hps[i] = lin[i];

        const harmonics = 3; // 3-level HPS is enough for phone mics
        /*for (let h = 2; h <= harmonics; h++) {
            for (let i = 0; i < hps.length / h; i++) {
                hps[i] *= lin[i * h];
            }
        }*/

        // FIND PEAK IN HPS
        let peakBin = 0, peakVal = 0;
        for (let i = fLimitLower; i < Math.min(hps.length - 1, fLimitUpper); i++) {
            if (hps[i] > peakVal) {
                peakVal = hps[i];
                peakBin = i;
            }
        }

        if (peakVal < 0.0000001) return;

        let coarseFreq = peakBin * binWidth;

        //b TEST DIVISORS
        let bestFreq = coarseFreq;
        /*let bestScore = -Infinity;

        for (let div = 1; div <= 4; div++) {
            let f = coarseFreq / div;
            if (f < 20) continue;

            let b = Math.round(f / binWidth);
            if (b < 1 || b*3 >= lin.length) continue;

            // score fundamental + harmonics
            let sc = lin[b] + 0.6*lin[b*2] + 0.3*lin[b*3];
            if (sc > bestScore) {
                bestScore = sc;
                bestFreq = f;
            }
        }*/

        // PARBOLIC INTERPOLATION 
        let baseBin = Math.round(bestFreq / binWidth);
        if (baseBin > 1 && baseBin < lin.length-2) {
            let y1 = lin[baseBin - 1];
            let y2 = lin[baseBin];
            let y3 = lin[baseBin + 1];

            let denom = (y1 - 2*y2 + y3);
            if (Math.abs(denom) > 1e-12) {
                let delta = 0.5 * (y1 - y3) / denom;
                bestFreq = (baseBin + delta) * binWidth;
            }
        }

        // OUTPUT
        document.getElementById("freq").innerText =
            bestFreq.toFixed(2) + " Hz";
        document.getElementById("note").innerText =
            freqToNoteName(bestFreq);

        let note = freqToNote(bestFreq);
        lastNote = lastNote + 0.4 * (note - lastNote);
        noteHistory[noteCursor++] = lastNote;
        if (noteCursor >= noteHistory.length) noteCursor = 0;

	    canvas_history.fillStyle = 'white';
        canvas_history.fillRect(0,0,cw,ch);

        canvas_history.strokeStyle = `hsl(${getColorHue(11)}, 70%, 50%)`;
        canvas_history.beginPath();

        let score = new Int16Array(camelotsA.length);
        for (let i = 0; i < noteHistory.length; i++) {
            score[Math.round(noteHistory[i]) % 12]++;

            const x = Math.round((i / noteHistory.length) * cw);
            const y = (24 - (noteHistory[(i + 1 + noteCursor) % noteHistory.length] % 24)) / 24 * ch;
            if (i == 0) canvas_history.moveTo(x,y);
            else canvas_history.lineTo(x,y);
        }

	    canvas_history.stroke();

        let max = -1;
        let maxc = 0;
        for (let i = 0; i < score.length; i++) {
            if (score[i] > maxc) {
                maxc = score[i];
                max = i;
            }
        }

        const camelota = document.getElementById("camelota");
        const camelotb = document.getElementById("camelotb");
        camelota.innerHTML = max == -1 ? "-" : camelotsA[max];
        camelota.style.color = `hsl(${getColorHue(max)}, 70%, 50%)`;
        camelotb.innerHTML = max == -1 ? "-" : camelotsB[max] + " (" + noteNames[max] + ")";
        camelotb.style.color = `hsl(${getColorHue((max - 3 + 12) % 12)}, 70%, 50%)`;
        drawPie(score);
    }

    setInterval(loop, 10);
}
