// Original pixel scenery, rendered at a deliberately small logical resolution.
export function drawWorld(canvas) {
  const c = canvas.getContext('2d');
  c.save();
  c.scale(canvas.width / 480, canvas.height / 250);
  c.imageSmoothingEnabled = false;
  let seed = 19;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const rect = (x, y, w, h, color) => {
    c.fillStyle = color;
    c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const poly = (points, color) => {
    c.fillStyle = color;
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fill();
  };
  const diamond = (x, y, w, h, color) =>
    poly(
      [
        [x, y - h / 2],
        [x + w / 2, y],
        [x, y + h / 2],
        [x - w / 2, y],
      ],
      color,
    );
  rect(0, 0, 480, 250, '#183732');
  rect(0, 115, 480, 135, '#214a42');
  for (let i = 0; i < 95; i++) {
    let x = rnd() * 480,
      y = rnd() * 105;
    rect(x, y, 1, 1, i % 6 ? '#426650' : '#bbad72');
  }
  // Broken clouds and the distant ridge keep the foreground island readable.
  for (const [x, y, w] of [
    [170, 35, 38],
    [244, 17, 30],
    [350, 36, 45],
    [418, 13, 50],
    [415, 63, 23],
  ]) {
    rect(x, y, w, 2, '#49644c');
    rect(x + 8, y - 3, w - 16, 3, '#49644c');
  }
  poly(
    [
      [142, 121],
      [164, 104],
      [185, 113],
      [213, 84],
      [235, 110],
      [260, 90],
      [283, 114],
      [308, 91],
      [332, 113],
      [360, 92],
      [402, 116],
      [448, 95],
      [480, 106],
      [480, 161],
      [142, 155],
    ],
    '#2a5143',
  );
  rect(382, 39, 22, 20, '#dfc580');
  rect(379, 44, 28, 12, '#dfc580');
  rect(382, 43, 8, 6, '#cdb978');
  for (let y = 140; y < 250; y += 7)
    for (let i = 0; i < 16; i++) {
      const x = rnd() * 480;
      rect(x, y, 3 + rnd() * 15, 1, rnd() > 0.6 ? '#376b58' : '#285442');
    }
  // Layered, stepped island silhouette.
  for (let y = 0; y < 120; y += 3) {
    const n = (y - 60) / 60;
    const width = Math.sqrt(Math.max(0, 1 - n * n)) * 150;
    rect(327 - width, 107 + y, width * 2, 7, '#142f2c');
  }
  for (let y = 0; y < 109; y += 3) {
    const n = (y - 54) / 55;
    const width = Math.sqrt(Math.max(0, 1 - n * n)) * 146;
    rect(327 - width, 104 + y, width * 2, 6, '#78624a');
  }
  for (let y = 0; y < 102; y += 3) {
    const n = (y - 51) / 52;
    const width = Math.sqrt(Math.max(0, 1 - n * n)) * 146;
    rect(327 - width, 102 + y, width * 2, 5, '#9a8855');
  }
  for (let y = 0; y < 96; y += 3) {
    const n = (y - 48) / 49;
    const width = Math.sqrt(Math.max(0, 1 - n * n)) * 145;
    rect(327 - width, 102 + y, width * 2, 4, '#6f864d');
  }
  for (let i = 0; i < 450; i++) {
    const x = 181 + rnd() * 292,
      y = 101 + rnd() * 101;
    if (((x - 327) / 143) ** 2 + ((y - 150) / 47) ** 2 < 0.98)
      rect(x, y, 1 + rnd() * 3, 1, rnd() > 0.5 ? '#809452' : '#5f7c48');
  }
  // Sunken river with a tiny working harbor.
  poly(
    [
      [371, 157],
      [385, 163],
      [390, 175],
      [383, 186],
      [401, 202],
      [421, 206],
      [422, 214],
      [398, 211],
      [371, 188],
      [378, 175],
      [369, 167],
    ],
    '#bdad6b',
  );
  poly(
    [
      [375, 160],
      [384, 166],
      [385, 175],
      [378, 186],
      [399, 207],
      [416, 208],
      [416, 213],
      [397, 211],
      [373, 187],
      [380, 175],
      [373, 165],
    ],
    '#3b8378',
  );
  for (let i = 0; i < 20; i++) rect(379 + rnd() * 7, 171 + rnd() * 12, 2, 1, '#71ab91');
  // Paths connect the games into a place rather than a grid of boxes.
  poly(
    [
      [243, 150],
      [250, 142],
      [323, 160],
      [371, 132],
      [379, 137],
      [330, 169],
      [388, 192],
      [379, 199],
      [320, 177],
    ],
    '#c2a765',
  );
  poly(
    [
      [282, 184],
      [308, 169],
      [315, 172],
      [292, 190],
    ],
    '#c2a765',
  );
  for (let i = 0; i < 45; i++) {
    const x = 259 + rnd() * 93,
      y = 151 + (x - 259) * 0.24;
    rect(x, y, 3, 1, '#ddbf75');
  }
  const tree = (x, y, size = 1) => {
    diamond(x + 3, y + 4, 14 * size, 5 * size, '#49633e');
    rect(x - 1, y - 9 * size, 3 * size, 11 * size, '#695435');
    rect(x - 7 * size, y - 23 * size, 14 * size, 13 * size, '#275d43');
    rect(x - 10 * size, y - 20 * size, 20 * size, 9 * size, '#33724a');
    rect(x - 6 * size, y - 27 * size, 12 * size, 13 * size, '#47844e');
    rect(x - 2 * size, y - 29 * size, 7 * size, 8 * size, '#669550');
    rect(x - 7 * size, y - 18 * size, 6 * size, 4 * size, '#548a48');
    rect(x + 4 * size, y - 20 * size, 5 * size, 7 * size, '#286449');
  };
  const pine = (x, y, s = 1) => {
    rect(x - 1, y - 4, 2, 7, '#785a38');
    poly(
      [
        [x, y - 29 * s],
        [x - 7 * s, y - 16 * s],
        [x - 4 * s, y - 16 * s],
        [x - 10 * s, y - 5 * s],
        [x + 11 * s, y - 5 * s],
        [x + 5 * s, y - 16 * s],
        [x + 8 * s, y - 16 * s],
      ],
      '#295d45',
    );
    poly(
      [
        [x, y - 29 * s],
        [x - 5 * s, y - 17 * s],
        [x - 2 * s, y - 17 * s],
        [x - 7 * s, y - 7 * s],
        [x, y - 7 * s],
      ],
      '#548249',
    );
  };
  for (const [x, y, s] of [
    [228, 134, 1],
    [244, 130, 1.1],
    [264, 115, 0.9],
    [283, 117, 0.85],
    [306, 107, 0.9],
    [337, 105, 0.75],
    [436, 137, 1.1],
    [448, 148, 0.9],
    [461, 156, 0.8],
    [422, 153, 0.8],
    [222, 166, 0.8],
    [212, 154, 0.9],
  ])
    tree(x, y, s);
  // Mountain trail and crystal cave.
  poly(
    [
      [405, 80],
      [382, 118],
      [383, 136],
      [418, 151],
      [450, 131],
      [438, 103],
      [426, 85],
      [422, 71],
    ],
    '#536e60',
  );
  poly(
    [
      [422, 71],
      [410, 111],
      [419, 129],
      [450, 131],
      [438, 103],
      [426, 85],
    ],
    '#728576',
  );
  poly(
    [
      [407, 80],
      [400, 91],
      [410, 89],
      [414, 96],
      [420, 86],
      [426, 91],
      [422, 71],
    ],
    '#d0d1ad',
  );
  poly(
    [
      [409, 129],
      [411, 116],
      [421, 111],
      [430, 118],
      [435, 139],
    ],
    '#233e39',
  );
  rect(416, 122, 4, 11, '#78b4a2');
  rect(421, 119, 3, 14, '#a5d7b6');
  rect(426, 127, 3, 7, '#57978c');
  pine(394, 140, 0.6);
  pine(437, 137, 0.7);
  pine(443, 122, 0.7);
  const house = (x, y, w, h, roof, light) => {
    diamond(x + w / 2 + 3, y + h + 1, w + 17, 13, '#4e673f');
    rect(x, y, w, h, '#d9ba79');
    poly(
      [
        [x + w, y],
        [x + w + 9, y - 5],
        [x + w + 9, y + h - 6],
        [x + w, y + h],
      ],
      '#9e915f',
    );
    rect(x + 2, y + 2, w - 4, 3, '#a68957');
    poly(
      [
        [x - 4, y],
        [x + 3, y - 13],
        [x + w - 1, y - 13],
        [x + w + 5, y],
      ],
      roof,
    );
    poly(
      [
        [x + w + 5, y],
        [x + w + 12, y - 6],
        [x + w + 4, y - 19],
        [x + w - 1, y - 13],
      ],
      '#743f32',
    );
    rect(x + 3, y - 10, w - 3, 2, '#d88750');
    rect(x + 7, y + 10, 8, 13, '#35534a');
    rect(x + 9, y + 12, 4, 8, light);
    rect(x + w - 14, y + 9, 8, 9, '#35534a');
    rect(x + w - 12, y + 11, 4, 5, light);
    rect(x - 2, y + h - 2, w + 4, 3, '#aa985e');
  };
  house(234, 139, 31, 26, '#a45538', '#edb657');
  rect(240, 137, 18, 4, '#304f43');
  // The arcade hall: checkerboard entry, striped awning, roof tiles and a warm doorway.
  diamond(345, 154, 76, 32, '#4a653d');
  house(314, 107, 56, 43, '#b9663f', '#ffda82');
  rect(338, 123, 14, 27, '#244b40');
  rect(340, 126, 10, 24, '#f7c969');
  rect(342, 132, 6, 18, '#b37b3d');
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 5; x++)
      rect(331 + x * 5, 150 + y * 3, 5, 3, (x + y) % 2 ? '#d9c487' : '#5b684b');
  rect(309, 119, 66, 4, '#f0bc68');
  for (let x = 0; x < 11; x++) rect(309 + x * 6, 119, 3, 5, '#9f4e34');
  rect(326, 99, 30, 13, '#254e43');
  rect(328, 101, 26, 9, '#e4b15b');
  c.fillStyle = '#304e40';
  c.font = 'bold 6px monospace';
  c.textBaseline = 'top';
  c.textAlign = 'center';
  c.fillText('ARCADE', 341, 103);
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 8; x++) rect(319 + x * 6 - y, 95 + y * 4, 4, 1, '#d9844a');
  rect(361, 84, 5, 14, '#d4ab71');
  rect(359, 83, 9, 3, '#aa754b');
  // Rooftop arcade mascot, an eight-bit star.
  poly(
    [
      [340, 67],
      [343, 75],
      [351, 75],
      [345, 80],
      [347, 87],
      [340, 83],
      [334, 87],
      [336, 80],
      [330, 75],
      [338, 75],
    ],
    '#efbd65',
  );
  rect(339, 86, 2, 6, '#bf9856');
  // A puzzle pavilion and a small sports court.
  house(284, 178, 25, 18, '#5d8790', '#b9d5a5');
  rect(278, 189, 8, 8, '#be8646');
  rect(280, 191, 4, 4, '#e9be65');
  diamond(345, 193, 40, 20, '#d2b76d');
  diamond(345, 192, 33, 16, '#599171');
  poly(
    [
      [330, 187],
      [332, 186],
      [361, 200],
      [359, 201],
    ],
    '#cad3a0',
  );
  rect(344, 181, 1, 16, '#c3b680');
  rect(331, 187, 1, 8, '#c3b680');
  // Wooden bridge and boat.
  for (let i = 0; i < 7; i++) rect(375 + i * 3, 183 + i, 3, 7, '#bd9a57');
  rect(375, 182, 22, 2, '#765b37');
  rect(376, 190, 20, 2, '#765b37');
  rect(435, 208, 19, 4, '#ad814a');
  rect(438, 212, 13, 3, '#826645');
  rect(443, 198, 1, 10, '#dcc18c');
  poly(
    [
      [444, 198],
      [451, 206],
      [444, 206],
    ],
    '#e7d5a7',
  );
  // Lampposts, flowers and visitors create scale.
  const lamp = (x, y) => {
    diamond(x, y + 1, 8, 4, '#586741');
    rect(x, y - 14, 2, 14, '#736344');
    rect(x - 2, y - 17, 6, 5, '#384d3c');
    rect(x - 1, y - 16, 4, 3, '#fbd77d');
  };
  lamp(312, 154);
  lamp(365, 156);
  lamp(252, 177);
  lamp(396, 182);
  for (const [x, y] of [
    [300, 131],
    [276, 155],
    [415, 165],
    [318, 191],
    [229, 158],
    [365, 185],
    [273, 174],
    [425, 184],
  ]) {
    rect(x, y, 1, 4, '#425f38');
    rect(x - 1, y - 1, 3, 2, '#e3bd70');
    rect(x + 4, y + 2, 2, 2, '#dc9363');
  }
  const person = (x, y, color, flip = 0) => {
    rect(x - 2, y + 6, 7, 2, '#4a623e');
    rect(x, y - 5, 4, 4, '#e8ba80');
    rect(x - 1, y - 7, 6, 3, color);
    rect(x - 1, y - 1, 6, 5, color);
    rect(x, y + 4, 2, 3, '#244c42');
    rect(x + 3, y + 4, 2, 3, '#244c42');
    rect(x + (flip ? 0 : 3), y - 4, 1, 1, '#273e35');
  };
  person(323, 157, '#85aa98');
  person(354, 165, '#cd7551', 1);
  person(272, 165, '#dfb959');
  person(407, 181, '#739ba4', 1);
  tree(229, 188, 1);
  tree(248, 200, 0.8);
  tree(423, 196, 0.75);
  pine(305, 212, 0.7);
  pine(327, 217, 0.65);
  c.restore();
}
