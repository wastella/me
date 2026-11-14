// Todoist's named palette, so imported projects keep their colours.
export const COLORS = {
  berry_red: '#b8255f', red: '#db4035', orange: '#ff9933', yellow: '#fad000',
  olive_green: '#afb83b', lime_green: '#7ecc49', green: '#299438', mint_green: '#6accbc',
  teal: '#158fad', sky_blue: '#14aaf5', light_blue: '#96c3eb', blue: '#4073ff',
  grape: '#884dff', violet: '#af38eb', lavender: '#eb96eb', magenta: '#e05194',
  salmon: '#ff8d85', charcoal: '#808080', grey: '#b8b8b8', taupe: '#ccac93',
};
// Colours handed to new projects and note categories, in turn.
export const PALETTE = ['blue', 'green', 'orange', 'grape', 'teal', 'magenta', 'yellow', 'salmon', 'mint_green', 'violet'];
export const nextColor = (used) => PALETTE[used % PALETTE.length];
export const colorHex = (name) => COLORS[name] || name || COLORS.charcoal;
