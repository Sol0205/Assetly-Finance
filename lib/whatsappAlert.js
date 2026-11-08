/** Build a WhatsApp click-to-chat URL. WhatsApp requires the user to press Send. */
function crearEnlaceWhatsapp(mensaje, toNumber) {
    const digits = toNumber.replace(/\D/g, '');
    return `https://wa.me/${digits}?text=${encodeURIComponent(mensaje)}`;
}

module.exports = { crearEnlaceWhatsapp };
