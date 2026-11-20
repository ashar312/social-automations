'use strict';
/**
 * LinkedIn PDF carousels (plans/07-linkedin-pdf-carousel.md).
 * media_files.kind += 'document', media_files.page_count (PDF pages; width/height = page 1 size in points),
 * posts.content_type += 'document'.
 */
module.exports = {
  async up(q, S) {
    await q.changeColumn('media_files', 'kind', { type: S.ENUM('image', 'video', 'thumbnail', 'document'), allowNull: false });
    await q.addColumn('media_files', 'page_count', { type: S.INTEGER, allowNull: true });
    await q.changeColumn('posts', 'content_type', { type: S.ENUM('text', 'image', 'video', 'reel', 'document'), allowNull: false });
    // LinkedIn document titles can be up to 400 characters
    await q.changeColumn('posts', 'title', { type: S.STRING(400), allowNull: true });
  },
  async down(q, S) {
    // MySQL would silently truncate 'document' values to '' when the ENUM shrinks, so refuse instead.
    const [[m]] = await q.sequelize.query("SELECT COUNT(*) AS n FROM media_files WHERE kind = 'document'");
    const [[p]] = await q.sequelize.query("SELECT COUNT(*) AS n FROM posts WHERE content_type = 'document'");
    if (Number(m.n) || Number(p.n)) {
      throw new Error(`Cannot undo: ${m.n} PDF media row(s) and ${p.n} PDF carousel post(s) exist. Delete them first.`);
    }
    const [[t]] = await q.sequelize.query('SELECT COUNT(*) AS n FROM posts WHERE CHAR_LENGTH(title) > 255');
    if (Number(t.n)) throw new Error(`Cannot undo: ${t.n} post title(s) are longer than 255 characters.`);
    await q.changeColumn('posts', 'title', { type: S.STRING(255), allowNull: true });
    await q.changeColumn('posts', 'content_type', { type: S.ENUM('text', 'image', 'video', 'reel'), allowNull: false });
    await q.removeColumn('media_files', 'page_count');
    await q.changeColumn('media_files', 'kind', { type: S.ENUM('image', 'video', 'thumbnail'), allowNull: false });
  },
};
