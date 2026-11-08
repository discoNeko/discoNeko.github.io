// グローバル名前空間とレシピ登録。
// file:// で直接開けるよう ES Modules は使わず、classic script を順に読み込む構成にしている。
window.SFX = {
  recipes: [],
  ui: {},
  registerRecipe(recipe) {
    this.recipes.push(recipe);
  },
  getRecipe(id) {
    return this.recipes.find((r) => r.id === id);
  },
};
