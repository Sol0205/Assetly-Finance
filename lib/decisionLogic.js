/**
 * Módulo de Lógica de Control (Motor de Decisión)
 * -------------------------------------------------
 * Implementa la regla de negocio solicitada:
 *   - sentimiento > umbralCompra -> señal de COMPRA
 *   - sentimiento < umbralVenta  -> señal de VENTA
 *   - en cualquier otro caso     -> MANTENER
 */

/**
 * @param {number} sentimientoPromedio - score en [-1, 1]
 * @param {number} umbralCompra
 * @param {number} umbralVenta
 * @returns {{ senal: 'COMPRA'|'VENTA'|'MANTENER', icono: string, color: string }}
 */
function generarSenal(sentimientoPromedio, umbralCompra = 0.5, umbralVenta = -0.5) {
    if (sentimientoPromedio > umbralCompra) {
        return { senal: 'COMPRA', icono: '🟢', color: '#2e7d5b' };
    } else if (sentimientoPromedio < umbralVenta) {
        return { senal: 'VENTA', icono: '🔴', color: '#c0392b' };
    } else {
        return { senal: 'MANTENER', icono: '🟡', color: '#c98a1d' };
    }
}

module.exports = { generarSenal };