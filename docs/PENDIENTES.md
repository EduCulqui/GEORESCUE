# Pendientes antes de operación real

Este documento registra dependencias que requieren validación institucional,
legal u operativa. No se deben reemplazar por datos de demostración ni tratar
como acuerdos confirmados.

## Validación oficial y legal

- Verificar con fuentes oficiales peruanas los números de emergencia que se
  mostrarán en la pantalla SOS (PNP 105, Bomberos 116 y SAMU 106), registrar
  fuente y fecha de verificación, y obtener revisión legal de su publicación.
- Obtener revisión legal del consentimiento, tratamiento de ubicación,
  conservación de alertas e historial, y protocolo de acceso a datos de
  familiares e instituciones.
- Definir convenios y responsabilidades de respuesta con las instituciones
  que decidan inscribirse. La plataforma no implica que una institución haya
  recibido, aceptado o atendido una alerta.

## Cobertura y operación institucional

- Definir y validar cómo se demuestra la cobertura geográfica de cada
  institución aprobada y activa antes de asignarle alertas.
- Acordar responsables, horarios de operación, protocolo de confirmación,
  escalamiento y revisión de fallos con cada institución participante.
- Validar que los datos de cada institución inscrita, aprobada y activa sean
  correctos y estén vigentes. No configurar una institución predeterminada.

## Dependencias técnicas externas

- No hay proveedores externos de notificación ni de rutas configurados. El
  fallback no despacha mensajes, no informa cobertura, y no calcula rutas,
  distancias ni tiempos estimados.
- Cualquier futura implementación de gateway requiere contrato e
  implementación por interfaz, configuración mediante variables de entorno,
  secretos fuera del código, pruebas de fallos y confirmaciones respaldadas
  por evidencia del proveedor.
- La operación del outbox requiere definir y probar su consumidor, política de
  reintentos y revisión de fallos antes de afirmar que los eventos pendientes
  se procesan automáticamente.

Las alertas actualmente se persisten en la plataforma. Los buzones familiares
solo incluyen vínculos aceptados y no revocados; no se envía información a
sistemas externos.
