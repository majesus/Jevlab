/**
 * JEVPRESETS — plantillas de preguntas (formato interno de la interfaz: {primitive, instructions, criteria})
 * y corpus de ejemplo (todo en inglés) para trabajar sin API.
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
      label: 'Moderation and tone',
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
        { text: 'We have detected a security breach: someone has accessed the customer database without authorization. We need to speak to a manager right now.', expect: { sentiment: 'negative', urgency: [2.4, 3], requires_human_reply: true } },
        { text: 'I love the new design of the app, congratulations to the team. Very good work.', expect: { sentiment: 'positive', urgency: [0, 0.8], requires_human_reply: false } },
        { text: 'The October invoice arrived with an incorrect amount. This is unacceptable, it is the third time it has happened.', expect: { sentiment: 'negative', urgency: [0.8, 2.4], requires_human_reply: false } },
        { text: 'The API documentation says the rate limit is 100 requests per minute.', expect: { sentiment: 'neutral', urgency: [0, 1.2], requires_human_reply: false } },
        { text: 'If we do not receive a reply from a lawyer at your company today, we will begin legal action for breach of contract.', expect: { sentiment: 'negative', urgency: [2.2, 3], requires_human_reply: true } },
        { text: 'Is there any way to speak to someone about my invoice?', expect: { sentiment: 'neutral', urgency: [0, 1.6], requires_human_reply: true } }
      ]
    },

    support_routing: {
      label: 'Support ticket routing',
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
        { text: 'I need to download the invoice for the last quarter and change the credit card associated with the subscription.', expect: { department: 'billing', technical_complexity: [0, 1.2], is_churn_risk: false } },
        { text: 'We are a team of 400 people and would like a quote for an enterprise contract with volume pricing.', expect: { department: 'sales', technical_complexity: [0, 1.2], is_churn_risk: false } },
        { text: 'We are considering canceling our contract unless SLA support is upgraded.', expect: { department: 'sales', technical_complexity: [0, 1.5], is_churn_risk: true } },
        { text: 'Where is your head office? I am a journalist and would like an interview for a press feature.', expect: { department: 'general', technical_complexity: [0, 1.0], is_churn_risk: false } },
        { text: 'I want to cancel my subscription and request a refund, I am not going to use the service anymore.', expect: { department: 'billing', technical_complexity: [0, 1.2], is_churn_risk: true } },
        { text: 'The API returns a 500 error when I POST to the /orders endpoint with a long payload. Stack trace attached.', expect: { department: 'engineering', technical_complexity: [1.6, 3], is_churn_risk: false } },
        { text: 'Hello, I forgot my password. Where is the link to get a new one?', expect: { department: 'general', technical_complexity: [0, 1.0], is_churn_risk: false } }
      ]
    },

    financial_intent: {
      label: 'Financial intent / KYC',
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
        { text: 'I want to deposit a check for 500 euros into my account; I am attaching the image of the check.', expect: { transaction_type: 'deposit', risk_tier: [0, 1.0], requires_id_verification: false } },
        { text: 'Please withdraw 9,900 USD to an external account abroad. I changed my password and email an hour ago and I have made four withdrawals already.', expect: { transaction_type: 'withdrawal', risk_tier: [1.2, 2], requires_id_verification: null } },
        { text: 'I do not recognize a charge of 340 euros from a merchant on my card. It is an unauthorized charge and I want to dispute it.', expect: { transaction_type: 'dispute', risk_tier: [0.4, 2], requires_id_verification: false } },
        { text: 'I need to transfer funds to a new third-party recipient in another country that I have never used before.', expect: { transaction_type: 'transfer', risk_tier: [0.6, 2], requires_id_verification: null } },
        { text: 'I want to withdraw 300 euros from my account at the ATM, as usual.', expect: { transaction_type: 'withdrawal', risk_tier: [0, 1.0], requires_id_verification: false } }
      ]
    },

    tourism_reviews: {
      label: 'Accommodation reviews (tourism)',
      questions: {
        main_aspect: {
          primitive: 'choice',
          instructions: 'Identify the aspect of the tourism service that the review mainly refers to.',
          criteria: {
            cleanliness: 'Cleanliness of rooms, bathrooms and common areas.',
            staff: 'Treatment, friendliness and professionalism of the staff and reception.',
            location: 'Position of the accommodation, access, views and proximity to points of interest.',
            price: 'Value for money, rates, offers and extra charges.',
            overcrowding: 'Tourist saturation, crowds, queues, noise and nuisance to residents.',
            other: 'None of the aspects above.'
          }
        },
        satisfaction: {
          primitive: 'score',
          instructions: 'Rate the overall level of satisfaction expressed by the author of the review.',
          criteria: [
            'Very dissatisfied: severe criticism and explicit refusal to return.',
            'Dissatisfied: more negative than positive aspects.',
            'Ambivalent: balanced praise and criticism, or a lukewarm assessment.',
            'Satisfied: positive experience with minor reservations.',
            'Very satisfied: enthusiastic praise and explicit recommendation.'
          ]
        },
        recommends: {
          primitive: 'noul',
          instructions: 'The review explicitly recommends the accommodation to other people.'
        },
        mentions_overcrowding: {
          primitive: 'noul',
          instructions: 'Does the author mention overcrowding, crowds or tourist saturation at the destination?'
        }
      },
      samples: [
        { text: 'Spotless room and a very clean bathroom. The reception staff were extremely kind. We will come back and I recommend it without hesitation.', expect: { main_aspect: ['cleanliness', 'staff'], satisfaction: [3.2, 4], recommends: true, mentions_overcrowding: false } },
        { text: 'The hotel is well located, but the overcrowding in the neighborhood is unbearable: queues for everything, packed streets and noise until 3 in the morning.', expect: { main_aspect: ['overcrowding'], satisfaction: [0.4, 2.4], recommends: false, mentions_overcrowding: true } },
        { text: 'Very high price for what they offer: they charged us extra fees that were not disclosed and the quality does not justify it. Very disappointed.', expect: { main_aspect: ['price'], satisfaction: [0, 1.6], recommends: false, mentions_overcrowding: false } },
        { text: 'The room was dirty, there were hairs in the bathroom and the sheets smelled bad. Terrible experience, never again.', expect: { main_aspect: ['cleanliness'], satisfaction: [0, 1.2], recommends: false, mentions_overcrowding: false } },
        { text: 'Perfect location, five minutes from the beach, with sea views from the terrace. We loved it.', expect: { main_aspect: ['location'], satisfaction: [3.0, 4], recommends: false, mentions_overcrowding: false } },
        { text: 'An acceptable stay, nothing more. The breakfast is ordinary and the staff attend well, but nothing special.', expect: { main_aspect: ['staff', 'other'], satisfaction: [1.4, 3.0], recommends: false, mentions_overcrowding: false } },
        { text: 'Good position near the old town, but crowds and endless queues. Not worth it in summer.', expect: { main_aspect: ['overcrowding', 'location'], satisfaction: [0.6, 2.6], recommends: false, mentions_overcrowding: true } },
        { text: 'The staff were rude and made us wait an hour at reception. Unacceptable treatment.', expect: { main_aspect: ['staff'], satisfaction: [0, 1.4], recommends: false, mentions_overcrowding: false } }
      ]
    },

    student_feedback: {
      label: 'Student feedback (teaching)',
      questions: {
        topic: {
          primitive: 'choice',
          instructions: "Indicate which aspect of the course the student's comment mainly addresses.",
          criteria: {
            content: 'Syllabus, concepts, depth and currency of the course content.',
            methodology: 'Explanations, pace of the classes, class dynamics, practical sessions and seminars.',
            assessment: 'Exams, grades, rubrics, criteria and submission deadlines.',
            workload: 'Amount of assignments, group projects and time needed outside class.',
            materials: 'Notes, slides, readings and virtual campus resources.',
            other: 'Any other matter not listed above.'
          }
        },
        clarity: {
          primitive: 'score',
          instructions: 'Rate how clearly the student says they understand the subject matter or the explanations.',
          criteria: [
            'Very confused: understands nothing and feels lost.',
            'Confused: major difficulties in understanding.',
            'Acceptable: understands the basics, with doubts.',
            'Clear: understands almost everything well.',
            'Very clear: understands everything and values the explanations.'
          ]
        },
        requests_change: {
          primitive: 'noul',
          instructions: 'The student explicitly requests a specific change in the course.'
        }
      },
      samples: [
        { text: 'The classes go too fast and I do not understand anything about the PLS-SEM part. I am completely lost.', expect: { topic: ['methodology'], clarity: [0, 1.4], requests_change: false } },
        { text: 'Please extend the deadline for the group assignment, there are too many tasks at once.', expect: { topic: ['workload', 'assessment'], clarity: [1.4, 3], requests_change: true } },
        { text: 'The lecturer\'s explanations are very clear and the examples help me a lot to understand consumer behavior. Excellent.', expect: { topic: ['methodology'], clarity: [3, 4], requests_change: false } },
        { text: 'The slides on the virtual campus contain typos and the notes do not match what is explained in class.', expect: { topic: ['materials'], clarity: [0.6, 2.6], requests_change: false } },
        { text: 'The exam was unfair: the grading criteria were not in the rubric and the grade seems incorrect to me. I would like you to change the grade.', expect: { topic: ['assessment'], clarity: [0.6, 2.8], requests_change: true } },
        { text: 'The syllabus is somewhat outdated: content on artificial intelligence and text analytics is missing.', expect: { topic: ['content'], clarity: [1.2, 3], requests_change: false } }
      ]
    }
  };

  /** Example labels for the entities tab (format {label: description}). */
  const NER_PRESETS = {
    academic: {
      label: 'Academic abstracts (as in Atlas)',
      labels: {
        theoretical_model: 'Named theory or model of technology acceptance, adoption or human behavior, such as TAM2, UTAUT2, TPB, TTF or DOI. Extract the exact name or abbreviation.',
        construct: 'Explicit theoretical construct or variable used in the study, such as perceived usefulness, social influence, trust or behavioral intention.',
        technology_object: 'Technology, digital service or system whose acceptance or adoption is studied.',
        data_collection: 'Explicit data collection instrument or source, such as questionnaire, interview, focus group, experiment or platform log.',
        analysis_technique: 'Explicit research analysis method, such as PLS-SEM, confirmatory factor analysis, regression, thematic analysis or bibliometric analysis.',
        sample: 'Explicit numeric sample size and sampled unit, such as 410 respondents or 25 studies.',
        context: 'Explicit study setting, population or sector, such as university teachers, hospitals or logistics firms.'
      },
      sample: 'This study extends UTAUT2 with perceived risk and trust to explain the behavioral intention of university teachers to adopt ChatGPT. A questionnaire was administered to 410 respondents in Spain and analysed with PLS-SEM, including a multigroup analysis. Performance expectancy and social influence were significant predictors, whereas price value was not.'
    },
    general: {
      label: 'General entities (person, organization, place, date…)',
      labels: {
        person: 'Name of a person, such as Manuel Sánchez or Dr. Smith.',
        organization: 'Company, university, institution or brand.',
        place: 'City, country, region or tourist destination.',
        date: 'Date, month, year or time reference.',
        amount: 'Monetary amount with its currency.',
        percentage: 'Percentage or rate.',
        contact: 'Email address, web link or phone number.'
      },
      sample: 'Dr. Manuel Sánchez, of the University of Seville, presented on 12 October 2026 in Madrid the results of a survey of 1,200 tourists: 37.5% spent more than 450 euros in Seville and Málaga. More information at tourism@example.org or at https://www.example.org. The project is funded by the Regional Government of Andalusia with €250,000.'
    },
    tourism: {
      label: 'Tourism and reviews',
      labels: {
        destination: 'City, country or tourist destination, such as Seville, Barcelona or Mallorca.',
        accommodation: 'Hotel, apartment or other type of accommodation, such as Hotel Alfonso XIII or Airbnb.',
        platform: 'Review or booking platform, such as TripAdvisor, Booking.com or Google Maps.',
        problem: 'Problem mentioned, such as overcrowding, noise, queues, dirtiness or high prices.',
        amount: 'Price or amount paid.'
      },
      sample: 'We stayed at the Hotel Alfonso XIII in Seville in August. We booked on Booking.com for 280 euros a night and, although the room was spotless, the overcrowding in the city centre and the queues at the Cathedral ruined the visit. On TripAdvisor many tourists comment on the noise at night.'
    },
    support: {
      label: 'Technical support and orders',
      labels: {
        product: 'Product, service or plan purchased, such as Fibre 600 router, Premium plan or mobile app.',
        order_number: 'Order, invoice, ticket or contract number, such as ORD-48213 or #2026-1187.',
        amount: 'Monetary amount with its currency, such as 49.90 euros or €120.',
        date: 'Date or deadline mentioned, such as 3 March, yesterday or within 48 hours.',
        issue: 'Problem described, such as service outage, duplicate charge, defective product or delivery delay.',
        contact: 'Email address, phone number or web link.'
      },
      sample: 'Hello, order ORD-48213 for the Fibre 600 router arrived on 3 March with a broken casing and I was charged 49.90 euros twice. I have been without service for 48 hours. You can write to me at lucia.perez@example.com or call me on 600 123 456.'
    },
    financial: {
      label: 'Finance and customer verification (KYC)',
      labels: {
        institution: 'Bank, insurer, broker or financial institution, such as Santander, CaixaBank or Revolut.',
        financial_product: 'Financial product, such as mortgage, credit card, index fund or term deposit.',
        amount: 'Monetary amount with its currency, such as 15,000 euros or €2,300.',
        interest_rate: 'Interest rate, APR or fee expressed as a percentage, such as 3.25% or APR of 4%.',
        date: 'Date or term, such as 1 January 2027 or over 25 years.',
        document: 'Type of identification or supporting document, such as national ID, passport, payslip or certificate of residence.'
      },
      sample: 'I applied at CaixaBank for a mortgage of 180,000 euros over 25 years with an interest rate of 3.25% and an arrangement fee of 0.5%. For verification I provided my national ID and the last two payslips on 14 January 2027.'
    },
    education: {
      label: 'Teaching and student opinions',
      labels: {
        course: 'Course, module or subject, such as Consumer Behavior, Statistics or Work Placement.',
        instructor: 'Lecturer, tutor or teaching team mentioned.',
        resource: 'Teaching resource or activity, such as the case study, the virtual campus, the slides, the forum or the multiple-choice exam.',
        assessment: 'Assessment element, such as final exam, group project, rubric, grade or exam session.',
        problem: 'Difficulty pointed out, such as excessive workload, overlapping deadlines or lack of feedback.',
        deadline: 'Date, deadline or duration, such as week 5, before 15 December or two hours.'
      },
      sample: 'In Consumer Behavior the case study on the virtual campus helped me a lot, but the final multiple-choice exam fell in the same week as the group project, and Professor Gómez did not publish the rubric until 15 December. There was a lack of feedback before the February exam session.'
    }
  };

  /* Definition template → the entities-tab label template that corresponds to it. */
  const NER_FOR = {
    content_moderation: 'general',
    support_routing: 'support',
    financial_intent: 'financial',
    tourism_reviews: 'tourism',
    student_feedback: 'education'
  };

  return { PRESETS, NER_PRESETS, NER_FOR };
});
