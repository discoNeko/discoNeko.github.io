// シード付き乱数。同じシード・同じパラメータなら毎回同じ音になる。
// レイヤーごとに (seed, layerKey) から独立した系列を作るので、
// あるレイヤーのパラメータを変えても他レイヤーのランダム要素は変わらない。
(function (SFX) {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash(seed, key) {
    let h = 2166136261 ^ (seed >>> 0);
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
    return h >>> 0;
  }

  function create(seed) {
    const next = mulberry32(seed);
    return {
      next,
      bipolar: () => next() * 2 - 1,
      range: (a, b) => a + (b - a) * next(),
      // ポアソン過程の発生間隔
      exp: (rate) => -Math.log(1 - next()) / rate,
    };
  }

  SFX.rng = { create, hash };
})(window.SFX);
