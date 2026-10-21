/**
 * JEVPRESETS — plantillas de preguntas (formato interno de la interfaz: {primitive, instructions, criteria})
 * y corpus de ejemplo en español/inglés para trabajar sin API.
 * `expect` en cada muestra documenta el resultado razonable esperado (lo usan las pruebas automáticas del simulador):
 *   choice → opción más probable; score → [mín, máx] del score; noul → true (≥0.5) / false (<0.5).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JEVPRESETS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PRESETS = {
    content_moderation: {
      label: 'Moderación y tono (EN/ES)',
      questions: {
        sentiment: {
          primitive: 'choice',
          instructions: 'Assess the overarching emotional valence and demeanor of this message.',
          criteria: {
            positive: 'Displays gratitude, satisfaction, optimism, or high praise.',
            neutral: 'Objective, fact-stating, calm question without emotional inflection.',
            negative: 'Displays frustration, anger, discontent, sarcasm, or hostility.'
          }
        },
        urgency: {
          primitive: 'score',
          instructions: 'Rate how critically urgent this input is for immediate executive or engineering escalation.',
          criteria: [
            'Low: Casual inquiry, cosmetic feedback, or general information request.',
            'Moderate: Standard issue or product question without immediate business impact.',
            'Elevated: Significant degradation of experience affecting daily user workflow.',
            'Critical: Total system outage, data breach, security hazard, or legal threat.'
          ]
        },
        requires_human_reply: {
          primitive: 'noul',
          instructions: 'Determine if an explicit reply from a human agent is demanded by the customer.'
        }
      },
      samples: [
        { text: 'URGENT: Our production cluster in eu-central has been returning HTTP 500 errors since the 14:00 UTC deployment. Customers cannot finish checkout. Please have an engineer look into this immediately!', expect: { sentiment: 'negative', urgency: [2.4, 3], requires_human_reply: null } },
        { text: 'Thanks, that fixed it! Great support as always.', expect: { sentiment: 'positive', urgency: [0, 0.8], requires_human_reply: false } },
        { text: 'Where can our accounting department download VAT tax invoices for Q3?', expect: { sentiment: 'neutral', urgency: [0, 1.4], requires_human_reply: false } },
        { text: 'I have asked three times now. Can I please just talk to a real person?', expect: { sentiment: ['negative', 'neutral'], urgency: [0.5, 2.2], requires_human_reply: true } },
        { text: 'Hemos detectado una brecha de seguridad: alguien ha accedido sin autorización a la base de datos de clientes. Necesitamos hablar con un responsable ahora mismo.', expect: { sentiment: 'negative', urgency: [2.4, 3], requires_human_reply: true } },
        { text: 'Me encanta el nuevo diseño de la aplicación, enhorabuena al equipo. Muy buen trabajo.', expect: { sentiment: 'positive', urgency: [0, 0.8], requires_human_reply: false } },
        { text: 'La factura de octubre llegó con un importe incorrecto. Es inaceptable, es la tercera vez que ocurre.', expect: { sentiment: 'negative', urgency: [0.8, 2.4], requires_human_reply: false } },
        { text: 'The API documentation says the rate limit is 100 requests per minute.', expect: { sentiment: 'neutral', urgency: [0, 1.2], requires_human_reply: false } },
        { text: 'Si no recibimos una respuesta de un abogado de su empresa hoy, iniciaremos acciones legales por incumplimiento del contrato.', expect: { sentiment: 'negative', urgency: [2.2, 3], requires_human_reply: true } },
        { text: 'Is there any way to speak to someone about my invoice?', expect: { sentiment: 'neutral', urgency: [0, 1.6], requires_human_reply: true } }
      ]
    },

    support_routing: {
      label: 'Enrutamiento de tickets de soporte',
      questions: {
        department: {
          primitive: 'choice',
          instructions: 'Categorize the ticket into the exact functional department responsible.',
          criteria: {
            engineering: 'Bug reports, API exceptions, 500 errors, SDK issues.',
            billing: 'Credit card changes, invoice downloads, refunds, plan tiers.',
            sales: 'Inquiries about custom enterprise contracts, pricing for large teams.',
            general: 'Company information, office location, press inquiries.'
          }
        },
        technical_complexity: {
          primitive: 'score',
          instructions: 'Estimate the technical sophistication required to resolve the inquiry.',
          criteria: [
            'Tier 0: Self-service knowledge base answer available.',
            'Tier 1: Basic account settings adjustment or guided walk-through.',
            'Tier 2: Advanced configuration or debugging logs inspection.',
            'Tier 3: Core codebase patch or architectural database mutation required.'
          ]
        },
        is_churn_risk: {
          primitive: 'noul',
          instructions: 'Does the user express an explicit intention to cancel their subscription or abandon the service?'
        }
      },
      samples: [
        { text: 'Our webhook payloads are being dropped at the gateway since yesterday and the SDK throws a timeout exception. Attaching the logs.', expect: { department: 'engineering', technical_complexity: [1.6, 3], is_churn_risk: false } },
        { text: 'Necesito descargar la factura del último trimestre y cambiar la tarjeta de crédito asociada a la suscripción.', expect: { department: 'billing', technical_complexity: [0, 1.2], is_churn_risk: false } },
        { text: 'We are a team of 400 people and would like a quote for an enterprise contract with volume pricing.', expect: { department: 'sales', technical_complexity: [0, 1.2], is_churn_risk: false } },
        { text: 'We are considering canceling our contract unless SLA support is upgraded.', expect: { department: 'sales', technical_complexity: [0, 1.5], is_churn_risk: true } },
        { text: '¿Dónde está vuestra oficina principal? Soy periodista y quisiera una entrevista para un reportaje de prensa.', expect: { department: 'general', technical_complexity: [0, 1.0], is_churn_risk: false } },
        { text: 'Quiero darme de baja de la suscripción y pedir un reembolso, ya no voy a usar el servicio.', expect: { department: 'billing', technical_complexity: [0, 1.2], is_churn_risk: true } },
        { text: 'The API returns a 500 error when I POST to the /orders endpoint with a long payload. Stack trace attached.', expect: { department: 'engineering', technical_complexity: [1.6, 3], is_churn_risk: false } },
        { text: 'Hola, ¿cómo puedo restablecer mi contraseña? No encuentro el enlace en la página.', expect: { department: 'general', technical_complexity: [0, 1.0], is_churn_risk: false } }
      ]
    },

    financial_intent: {
      label: 'Intención financiera / KYC',
      questions: {
        transaction_type: {
          primitive: 'choice',
          instructions: 'Identify the primary financial action indicated by the user.',
          criteria: {
            transfer: 'Sending capital between accounts or to another recipient.',
            deposit: 'Adding funds via wire, card, or check image.',
            withdrawal: 'Cashing out to an external banking account.',
            dispute: 'Contesting an unauthorized charge or merchant discrepancy.'
          }
        },
        risk_tier: {
          primitive: 'score',
          instructions: 'Classify the inherent AML/fraud suspicion level of this operation.',
          criteria: [
            'Minimal: Normal account behavior within standard volume thresholds.',
            'Elevated: Unusual location or unverified third-party recipient.',
            'High: Rapid sequential withdrawals following credentials modification.'
          ]
        },
        requires_id_verification: {
          primitive: 'noul',
          instructions: 'Does this intent trigger mandatory secondary identity documentation verification?'
        }
      },
      samples: [
        { text: 'I want to send 2,000 euros by bank transfer to my landlord, here is his IBAN.', expect: { transaction_type: 'transfer', risk_tier: [0, 1.0], requires_id_verification: false } },
        { text: 'Quiero ingresar un cheque de 500 euros en mi cuenta; adjunto la imagen del cheque.', expect: { transaction_type: 'deposit', risk_tier: [0, 1.0], requires_id_verification: false } },
        { text: 'Please withdraw 9,900 USD to an external account abroad. I changed my password and email an hour ago and I have made four withdrawals already.', expect: { transaction_type: 'withdrawal', risk_tier: [1.2, 2], requires_id_verification: null } },
        { text: 'No reconozco un cargo de 340 euros de un comercio en mi tarjeta. Es un cargo no autorizado y quiero reclamarlo.', expect: { transaction_type: 'dispute', risk_tier: [0.4, 2], requires_id_verification: false } },
        { text: 'I need to transfer funds to a new third-party recipient in another country that I have never used before.', expect: { transaction_type: 'transfer', risk_tier: [0.6, 2], requires_id_verification: null } },
        { text: 'Quiero retirar 300 euros de mi cuenta al cajero automático, como siempre.', expect: { transaction_type: 'withdrawal', risk_tier: [0, 1.0], requires_id_verification: false } }
      ]
    },

    tourism_reviews: {
      label: 'Reseñas de alojamiento (turismo, ES)',
      questions: {
        aspecto_principal: {
          primitive: 'choice',
          instructions: 'Identifica el aspecto del servicio turístico al que se refiere principalmente la reseña.',
          criteria: {
            limpieza: 'Estado de limpieza de habitaciones, baños y zonas comunes.',
            personal: 'Trato, amabilidad y profesionalidad del personal y de la recepción.',
            ubicacion: 'Situación del alojamiento, accesos, vistas y cercanía a puntos de interés.',
            precio: 'Relación calidad-precio, tarifas, ofertas y cargos extra.',
            masificacion: 'Saturación turística, aglomeraciones, colas, ruido y molestias a residentes.',
            otro: 'Ninguno de los aspectos anteriores.'
          }
        },
        satisfaccion: {
          primitive: 'score',
          instructions: 'Valora el grado de satisfacción global que expresa el autor de la reseña.',
          criteria: [
            'Muy insatisfecho: críticas severas y rechazo explícito a volver.',
            'Insatisfecho: más aspectos negativos que positivos.',
            'Ambivalente: elogios y críticas equilibrados o valoración tibia.',
            'Satisfecho: experiencia positiva con matices menores.',
            'Muy satisfecho: elogio entusiasta y recomendación explícita.'
          ]
        },
        recomienda: {
          primitive: 'noul',
          instructions: 'La reseña recomienda de forma explícita el alojamiento a otras personas.'
        },
        menciona_saturacion: {
          primitive: 'noul',
          instructions: '¿Menciona el autor masificación, aglomeraciones o saturación turística en el destino?'
        }
      },
      samples: [
        { text: 'Habitación impecable y baño muy limpio. El personal de recepción fue amabilísimo. Volveremos y lo recomiendo sin dudar.', expect: { aspecto_principal: ['limpieza', 'personal'], satisfaccion: [3.2, 4], recomienda: true, menciona_saturacion: false } },
        { text: 'El hotel está bien situado, pero la masificación del barrio es insoportable: colas para todo, calles abarrotadas y ruido hasta las 3 de la madrugada.', expect: { aspecto_principal: ['masificacion'], satisfaccion: [0.4, 2.4], recomienda: false, menciona_saturacion: true } },
        { text: 'Precio altísimo para lo que ofrecen: nos cobraron cargos extra no avisados y la calidad no lo merece. Muy decepcionados.', expect: { aspecto_principal: ['precio'], satisfaccion: [0, 1.6], recomienda: false, menciona_saturacion: false } },
        { text: 'La habitación estaba sucia, había pelos en el baño y las sábanas olían mal. Pésima experiencia, nunca más.', expect: { aspecto_principal: ['limpieza'], satisfaccion: [0, 1.2], recomienda: false, menciona_saturacion: false } },
        { text: 'Ubicación perfecta, a cinco minutos de la playa, con vistas al mar desde la terraza. Nos encantó.', expect: { aspecto_principal: ['ubicacion'], satisfaccion: [3.0, 4], recomienda: false, menciona_saturacion: false } },
        { text: 'Estancia correcta, sin más. El desayuno es normal y el personal atiende bien, pero nada especial.', expect: { aspecto_principal: ['personal', 'otro'], satisfaccion: [1.4, 3.0], recomienda: false, menciona_saturacion: false } },
        { text: 'Great location near the old town, but the area is overcrowded with tourists and the queues are endless. Not worth it in summer.', expect: { aspecto_principal: ['masificacion', 'ubicacion'], satisfaccion: [0.6, 2.6], recomienda: false, menciona_saturacion: true } },
        { text: 'El personal fue grosero y nos hicieron esperar una hora en recepción. Trato inaceptable.', expect: { aspecto_principal: ['personal'], satisfaccion: [0, 1.4], recomienda: false, menciona_saturacion: false } }
      ]
    },

    student_feedback: {
      label: 'Feedback de estudiantes (docencia, ES)',
      questions: {
        tema: {
          primitive: 'choice',
          instructions: 'Indica sobre qué aspecto de la asignatura trata principalmente el comentario del estudiante.',
          criteria: {
            contenidos: 'Temario, conceptos, profundidad y actualidad de los contenidos.',
            metodologia: 'Explicaciones, ritmo de las clases, dinámica, prácticas y seminarios.',
            evaluacion: 'Exámenes, calificaciones, rúbricas, criterios y plazos de entrega.',
            carga_trabajo: 'Cantidad de tareas, trabajos en grupo y tiempo necesario fuera de clase.',
            materiales: 'Apuntes, diapositivas, lecturas y recursos del campus virtual.',
            otro: 'Cualquier otro asunto no recogido arriba.'
          }
        },
        claridad: {
          primitive: 'score',
          instructions: 'Valora la claridad con la que el estudiante dice entender la materia o las explicaciones.',
          criteria: [
            'Muy confuso: no entiende nada y se siente perdido.',
            'Confuso: grandes dificultades de comprensión.',
            'Aceptable: entiende lo básico, con dudas.',
            'Claro: entiende bien casi todo.',
            'Muy claro: lo entiende todo y valora las explicaciones.'
          ]
        },
        pide_cambio: {
          primitive: 'noul',
          instructions: 'El estudiante solicita de forma explícita un cambio concreto en la asignatura.'
        }
      },
      samples: [
        { text: 'Las clases van demasiado rápido y no entiendo nada de la parte de PLS-SEM. Estoy completamente perdido.', expect: { tema: ['metodologia'], claridad: [0, 1.4], pide_cambio: false } },
        { text: 'Os pido por favor que alarguéis el plazo de entrega del trabajo en grupo, no llegamos con tantas tareas a la vez.', expect: { tema: ['carga_trabajo', 'evaluacion'], claridad: [1.4, 3], pide_cambio: true } },
        { text: 'Las explicaciones del profesor son muy claras y los ejemplos me ayudan mucho a entender el comportamiento del consumidor. Excelente.', expect: { tema: ['metodologia'], claridad: [3, 4], pide_cambio: false } },
        { text: 'Las diapositivas del campus virtual tienen erratas y los apuntes no coinciden con lo que se explica en clase.', expect: { tema: ['materiales'], claridad: [0.6, 2.6], pide_cambio: false } },
        { text: 'El examen fue injusto: los criterios de calificación no estaban en la rúbrica y la nota me parece incorrecta. Solicito una revisión.', expect: { tema: ['evaluacion'], claridad: [0.6, 2.8], pide_cambio: true } },
        { text: 'El temario está algo desactualizado: faltan contenidos sobre inteligencia artificial y analítica de texto.', expect: { tema: ['contenidos'], claridad: [1.2, 3], pide_cambio: false } }
      ]
    }
  };

  /** Etiquetas de ejemplo para la pestaña de entidades (formato {etiqueta: descripción}). */
  const NER_PRESETS = {
    academic: {
      label: 'Abstracts académicos (como en Atlas)',
      labels: {
        modelo_teorico: 'Named theory or model of technology acceptance, adoption or human behavior, such as TAM2, UTAUT2, TPB, TTF or DOI. Extract the exact name or abbreviation.',
        constructo: 'Explicit theoretical construct or variable used in the study, such as perceived usefulness, social influence, trust or behavioral intention.',
        tecnologia_objeto: 'Technology, digital service or system whose acceptance or adoption is studied.',
        recogida_datos: 'Explicit data collection instrument or source, such as questionnaire, interview, focus group, experiment or platform log.',
        tecnica_analisis: 'Explicit research analysis method, such as PLS-SEM, confirmatory factor analysis, regression, thematic analysis or bibliometric analysis.',
        muestra: 'Explicit numeric sample size and sampled unit, such as 410 respondents or 25 studies.',
        contexto: 'Explicit study setting, population or sector, such as university teachers, hospitals or logistics firms.'
      },
      sample: 'This study extends UTAUT2 with perceived risk and trust to explain the behavioral intention of university teachers to adopt ChatGPT. A questionnaire was administered to 410 respondents in Spain and analysed with PLS-SEM, including a multigroup analysis. Performance expectancy and social influence were significant predictors, whereas price value was not.'
    },
    general: {
      label: 'Entidades generales (persona, organización, lugar, fecha…)',
      labels: {
        persona: 'Nombre de una persona, como Manuel Sánchez o Dr. Smith.',
        organizacion: 'Empresa, universidad, institución o marca.',
        lugar: 'Ciudad, país, región o destino turístico.',
        fecha: 'Fecha, mes, año o referencia temporal.',
        importe: 'Cantidad monetaria con su divisa.',
        porcentaje: 'Porcentaje o tasa.',
        contacto: 'Correo electrónico, enlace web o teléfono.'
      },
      sample: 'El Dr. Manuel Sánchez, de la Universidad de Sevilla, presentó el 12 de octubre de 2026 en Madrid los resultados de una encuesta a 1.200 turistas: el 37,5 % gastó más de 450 euros en Sevilla y Málaga. Más información en turismo@us.es o en https://www.us.es. El proyecto lo financia la Junta de Andalucía con 250.000 €.'
    },
    tourism: {
      label: 'Turismo y reseñas',
      labels: {
        destino: 'Ciudad, país o destino turístico, como Sevilla, Barcelona o Mallorca.',
        alojamiento: 'Hotel, apartamento u otro tipo de alojamiento, como Hotel Alfonso XIII o Airbnb.',
        plataforma: 'Plataforma de reseñas o reservas, como TripAdvisor, Booking.com o Google Maps.',
        problema: 'Problema mencionado, como masificación, ruido, colas, suciedad o precios altos.',
        importe: 'Precio o importe pagado.'
      },
      sample: 'Nos alojamos en el Hotel Alfonso XIII de Sevilla en agosto. Reservamos en Booking.com por 280 euros la noche y, aunque la habitación estaba impecable, la masificación en el centro y las colas en la Catedral nos arruinaron la visita. En TripAdvisor muchos turistas comentan el ruido por las noches.'
    },
    support: {
      label: 'Soporte técnico y pedidos',
      labels: {
        producto: 'Producto, servicio o plan contratado, como router Fibra 600, plan Premium o aplicación móvil.',
        numero_pedido: 'Número de pedido, factura, ticket o contrato, como PED-48213 o #2026-1187.',
        importe: 'Cantidad monetaria con su divisa, como 49,90 euros o 120 €.',
        fecha: 'Fecha o plazo mencionado, como el 3 de marzo, ayer o en 48 horas.',
        incidencia: 'Problema descrito, como corte de servicio, cobro duplicado, producto defectuoso o retraso en la entrega.',
        contacto: 'Correo electrónico, teléfono o enlace web.'
      },
      sample: 'Hola, el pedido PED-48213 del router Fibra 600 llegó el 3 de marzo con la carcasa rota y me cobraron 49,90 euros dos veces. Llevo 48 horas sin servicio. Pueden escribirme a lucia.perez@ejemplo.es o llamarme al 600 123 456.'
    },
    financial: {
      label: 'Finanzas y verificación de clientes (KYC)',
      labels: {
        entidad: 'Banco, aseguradora, bróker o entidad financiera, como Santander, CaixaBank o Revolut.',
        producto_financiero: 'Producto financiero, como hipoteca, tarjeta de crédito, fondo indexado o depósito a plazo.',
        importe: 'Cantidad monetaria con su divisa, como 15.000 euros o 2.300 €.',
        tipo_interes: 'Tipo de interés, TAE o comisión expresados como porcentaje, como 3,25 % o TAE del 4 %.',
        fecha: 'Fecha o plazo, como el 1 de enero de 2027 o a 25 años.',
        documento: 'Tipo de documento de identificación o justificante, como DNI, pasaporte, nómina o certificado de residencia.'
      },
      sample: 'Solicité en CaixaBank una hipoteca de 180.000 euros a 25 años con un tipo de interés del 3,25 % y una comisión de apertura del 0,5 %. Para la verificación aporté el DNI y las dos últimas nóminas el 14 de enero de 2027.'
    },
    education: {
      label: 'Docencia y opiniones de estudiantes',
      labels: {
        asignatura: 'Asignatura, módulo o curso, como Comportamiento del Consumidor, Estadística o Prácticas Externas.',
        docente: 'Profesor, tutor o equipo docente mencionado.',
        recurso: 'Recurso o actividad docente, como el caso práctico, el campus virtual, las diapositivas, el foro o el examen tipo test.',
        evaluacion: 'Elemento de evaluación, como examen final, trabajo en grupo, rúbrica, nota o convocatoria.',
        problema: 'Dificultad señalada, como exceso de carga de trabajo, solapamiento de entregas o falta de feedback.',
        plazo: 'Fecha, plazo o duración, como la semana 5, antes del 15 de diciembre o dos horas.'
      },
      sample: 'En Comportamiento del Consumidor el caso práctico del campus virtual me ayudó mucho, pero el examen final tipo test cayó en la misma semana que el trabajo en grupo, y la profesora Gómez no publicó la rúbrica hasta el 15 de diciembre. Faltó feedback antes de la convocatoria de febrero.'
    }
  };

  /* Plantilla de Definición → plantilla de etiquetas de la pestaña Entidades que le corresponde. */
  const NER_FOR = {
    content_moderation: 'general',
    support_routing: 'support',
    financial_intent: 'financial',
    tourism_reviews: 'tourism',
    student_feedback: 'education'
  };

  return { PRESETS, NER_PRESETS, NER_FOR };
});
