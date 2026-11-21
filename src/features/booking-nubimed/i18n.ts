import type { SiteLocale } from './types';

export function vendorLocaleFromSite(lang: SiteLocale): string {
	return lang;
}

type BookingStrings = {
	stepLabelPrefix: string;
	loadingBootstrap: string;
	loadingDays: string;
	loadingSlots: string;
	retry: string;
	continue: string;
	next: string;
	previous: string;
	finalize: string;
	confirm: string;
	networkError: string;
	parseError: string;
	invalidResponse: string;
	invalidPreset: string;
	noDays: string;
	noSlots: string;
	selectSpecialty: string;
	selectTreatment: string;
	selectArea: string;
	areaLabel: string;
	stepsAriaLabel: string;
	selectDay: string;
	selectSlot: string;
	selectProfessional: string;
	availabilityNotice: string;
	gateBlocked: string;
	openPortal: string;
	detailsHeading: string;
	specialtyStepDescription: string;
	treatmentStepDescription: string;
	/** Aviso bajo las tarjetas de servicio (primera visita y tratamientos). */
	treatmentNotice: readonly string[];
	treatmentNoticeLabel: string;
	areaStepDescription: string;
	dateTimeStepDescription: string;
	detailsStepDescription: string;
	summaryHeading: string;
	patientHadVisitBefore: string;
	modeNewPatient: string;
	modeReturningPatient: string;
	fieldDni: string;
	fieldBirthDate: string;
	fieldName: string;
	fieldSurname: string;
	fieldPhonePrefix: string;
	fieldPhone: string;
	fieldEmail: string;
	privacyCheckbox: string;
	privacyRequired: string;
	fieldsRequired: string;
	loadingConfirmPage: string;
	confirmTitle: string;
	confirmIntro: string;
	confirmBackHint: string;
	confirmSubmitHint: string;
	confirmDisclaimer: string;
	submitting: string;
	submitSuccess: string;
	submitFailed: string;
	recaptchaFailed: string;
	backToSlots: string;
	serviceLabel: string;
	specialtyLabel: string;
	treatmentLabel: string;
	dateLabel: string;
	timeLabel: string;
	locationLabel: string;
	appointmentDurationHint: string;
	/** REQ-13: resumen breve antes del consentimiento (detalle en política de privacidad). */
	bookingLegalSummaryHeading: string;
	bookingLegalSummaryBody: string;
	privacyPolicyLinkLabel: string;
	marketingCheckbox: string;
	/** Texto sustituto si se oculta la insignia reCAPTCHA (requisito Google). */
	recaptchaIntro: string;
	recaptchaPrivacyLink: string;
	recaptchaAndTerms: string;
	recaptchaTermsLink: string;
	recaptchaLegalSuffix: string;
};

const STRINGS: Record<SiteLocale, BookingStrings> = {
	es: {
		stepLabelPrefix: 'STEP',
		loadingBootstrap: 'Preparando agenda…',
		loadingDays: 'Cargando días disponibles…',
		loadingSlots: 'Cargando horas…',
		retry: 'Reintentar',
		continue: 'Siguiente',
		next: 'Siguiente',
		previous: 'Anterior',
		finalize: 'Finalizar',
		confirm: 'Confirmar',
		networkError: 'Error de red. Compruebe la conexión e inténtelo de nuevo.',
		parseError: 'La respuesta del proveedor no es reconocida.',
		invalidResponse: 'Datos de disponibilidad no válidos.',
		invalidPreset: 'La especialidad indicada no es válida. Elija una opción de la lista.',
		noDays: 'No hay días disponibles en este momento.',
		noSlots: 'No hay franjas para este día.',
		selectSpecialty: 'Especialidad',
		selectTreatment: 'Servicio',
		selectArea: 'Centro',
		areaLabel: 'Centro',
		stepsAriaLabel: 'Pasos de la reserva',
		selectDay: 'Elige Día',
		selectSlot: 'Elige Hora',
		selectProfessional: 'Profesional',
		availabilityNotice:
			'La disponibilidad puede cambiar. Complete sus datos para enviar la solicitud y la clínica le confirmará por correo o teléfono.',
		gateBlocked:
			'No se puede cargar la agenda desde este sitio (acceso bloqueado). Puede continuar en el portal oficial.',
		openPortal: 'Abrir portal de reservas',
		detailsHeading: 'Datos de la reserva',
		specialtyStepDescription: 'Elige el área clínica que mejor se ajusta a tu objetivo.',
		treatmentStepDescription: 'Selecciona el servicio',
		treatmentNoticeLabel: 'Información sobre la visita',
		treatmentNotice: [
			'En la primera visita realizamos una valoración médica personalizada de tus necesidades y objetivos, y te proponemos un plan con distintas alternativas terapéuticas; si inicias alguno de los tratamientos propuestos, el importe de la consulta se descuenta de su precio.',
			'El tratamiento puede realizarse el mismo día, según disponibilidad de agenda.',
		],
		areaStepDescription: 'Elige el centro en el que prefieres tu visita.',
		dateTimeStepDescription: 'Primero elige fecha; después te mostraremos las horas disponibles.',
		detailsStepDescription: 'Completa tus datos para enviar la solicitud de cita.',
		summaryHeading: 'Resumen',
		patientHadVisitBefore: '¿Ha tenido cita antes con la clínica?',
		modeNewPatient: 'Nuevo paciente',
		modeReturningPatient: 'Ya registrado',
		fieldDni: 'DNI o pasaporte',
		fieldBirthDate: 'Fecha de nacimiento',
		fieldName: 'Nombre',
		fieldSurname: 'Apellidos',
		fieldPhonePrefix: 'Prefijo telefónico',
		fieldPhone: 'Teléfono',
		fieldEmail: 'Correo electrónico',
		privacyCheckbox: 'He leído y acepto la política de privacidad y las condiciones',
		privacyRequired: 'Debe aceptar la política de privacidad para continuar.',
		fieldsRequired: 'Revise los campos obligatorios.',
		loadingConfirmPage: 'Cargando formulario de confirmación…',
		confirmTitle: 'Confirmar envío',
		confirmIntro: 'Está a punto de finalizar la solicitud de su cita.',
		confirmBackHint:
			'Al pulsar Anterior podrá revisar los datos. Al pulsar Finalizar se enviará la solicitud y la clínica le confirmará por correo (revise la carpeta de spam), teléfono, SMS o WhatsApp.',
		confirmSubmitHint: '',
		confirmDisclaimer:
			'La fecha u hora final pueden variar por planificación. Si tiene problemas, contacte con la clínica.',
		submitting: 'Enviando…',
		submitSuccess: 'Solicitud enviada correctamente. En breve le contactarán para confirmar la cita.',
		submitFailed: 'No se pudo completar la reserva. Inténtelo de nuevo o use el portal oficial.',
		recaptchaFailed: 'No se pudo verificar reCAPTCHA. Pruébelo desde el portal oficial o más tarde.',
		backToSlots: 'Volver a elegir hora',
		serviceLabel: 'Servicio',
		specialtyLabel: 'Especialidad',
		treatmentLabel: 'Tratamiento',
		dateLabel: 'Fecha',
		timeLabel: 'Hora',
		locationLabel: 'Ubicación',
		appointmentDurationHint: 'Las citas suelen durar entre 45 y 60 minutos.',
		bookingLegalSummaryHeading: 'Resumen del tratamiento de datos',
		bookingLegalSummaryBody:
			'El responsable es el titular identificado en la política de privacidad. Los datos se tratan para gestionar su solicitud de cita y las comunicaciones necesarias con la clínica; base legal: medidas precontractuales a su solicitud y, en su caso, interés legítimo en la seguridad del envío. Nubimed / Clínica en la nube actúa como encargado siguiendo instrucciones del responsable.',
		privacyPolicyLinkLabel: 'Política de privacidad (información ampliada)',
		marketingCheckbox: 'Deseo recibir comunicaciones comerciales (opcional).',
		recaptchaIntro: 'Este sitio está protegido por reCAPTCHA y se aplican la',
		recaptchaPrivacyLink: 'Política de privacidad de Google',
		recaptchaAndTerms: ' y los',
		recaptchaTermsLink: 'Términos de servicio de Google',
		recaptchaLegalSuffix: '.',
	},
	en: {
		stepLabelPrefix: 'STEP',
		loadingBootstrap: 'Preparing booking…',
		loadingDays: 'Loading available days…',
		loadingSlots: 'Loading time slots…',
		retry: 'Retry',
		continue: 'Next',
		next: 'Next',
		previous: 'Back',
		finalize: 'Submit request',
		confirm: 'Confirm',
		networkError: 'Network error. Check your connection and try again.',
		parseError: 'Unrecognized response from the booking provider.',
		invalidResponse: 'Invalid availability data.',
		invalidPreset: 'The requested specialty is not valid. Please choose from the list.',
		noDays: 'No available days at the moment.',
		noSlots: 'No slots for this day.',
		selectSpecialty: 'Specialty',
		selectTreatment: 'Service',
		selectArea: 'Centre',
		areaLabel: 'Centre',
		stepsAriaLabel: 'Booking steps',
		selectDay: 'Choose day',
		selectSlot: 'Choose time',
		selectProfessional: 'Professional',
		availabilityNotice:
			'Availability may change. Enter your details to submit the request and the clinic will confirm by email or phone.',
		gateBlocked:
			'The schedule cannot be loaded from this site (access blocked). You can continue on the official portal.',
		openPortal: 'Open booking portal',
		detailsHeading: 'Booking details',
		specialtyStepDescription: 'Choose the clinical area that best fits your goal.',
		treatmentStepDescription: 'Select the service',
		treatmentNoticeLabel: 'About your visit',
		treatmentNotice: [
			'At your first visit we carry out a personalised medical assessment of your needs and goals and propose a plan with several treatment options; if you go ahead with any of them, the consultation fee is deducted from the treatment price.',
			'Treatment can take place on the same day, subject to availability.',
		],
		areaStepDescription: 'Choose the centre where you would like your visit.',
		dateTimeStepDescription: 'Choose a date first; then we will show available times.',
		detailsStepDescription: 'Complete your details to submit the booking request.',
		summaryHeading: 'Summary',
		patientHadVisitBefore: 'Have you visited this clinic before?',
		modeNewPatient: 'New patient',
		modeReturningPatient: 'Already registered',
		fieldDni: 'ID or passport',
		fieldBirthDate: 'Date of birth',
		fieldName: 'First name',
		fieldSurname: 'Last name',
		fieldPhonePrefix: 'Country calling code',
		fieldPhone: 'Phone',
		fieldEmail: 'Email',
		privacyCheckbox: 'I have read and accept the privacy policy and the terms',
		privacyRequired: 'You must accept the privacy policy to continue.',
		fieldsRequired: 'Please fill in all required fields.',
		loadingConfirmPage: 'Loading confirmation form…',
		confirmTitle: 'Confirm submission',
		confirmIntro: 'You are about to submit your appointment request.',
		confirmBackHint:
			'Use Back to review your details. Use Submit request to send the request; the clinic will confirm by email (check your spam folder), phone, SMS, or WhatsApp.',
		confirmSubmitHint: '',
		confirmDisclaimer:
			'The final date or time may differ due to scheduling. If you have issues, contact the clinic.',
		submitting: 'Sending…',
		submitSuccess: 'Request sent successfully. The clinic will contact you shortly to confirm.',
		submitFailed: 'The booking could not be completed. Try again or use the official portal.',
		recaptchaFailed: 'reCAPTCHA could not be verified. Try the official portal or try again later.',
		backToSlots: 'Back to time selection',
		serviceLabel: 'Service',
		specialtyLabel: 'Specialty',
		treatmentLabel: 'Treatment',
		dateLabel: 'Date',
		timeLabel: 'Time',
		locationLabel: 'Location',
		appointmentDurationHint: 'Appointments typically last 45 to 60 minutes.',
		bookingLegalSummaryHeading: 'How we use your data (summary)',
		bookingLegalSummaryBody:
			'The controller is identified in the site privacy policy. We process your data to handle your appointment request and necessary clinic communications; legal basis: pre-contractual steps at your request and, where applicable, legitimate interest in securing the submission. Nubimed / Clinica en la nube acts as a processor on the controller’s instructions.',
		privacyPolicyLinkLabel: 'Privacy policy (full information)',
		marketingCheckbox: 'I would like to receive commercial communications (optional).',
		recaptchaIntro: 'This site is protected by reCAPTCHA. The ',
		recaptchaPrivacyLink: 'Google Privacy Policy',
		recaptchaAndTerms: ' and ',
		recaptchaTermsLink: 'Terms of Service',
		recaptchaLegalSuffix: ' apply.',
	},
	ca: {
		stepLabelPrefix: 'STEP',
		loadingBootstrap: 'Preparant agenda…',
		loadingDays: 'Carregant dies disponibles…',
		loadingSlots: 'Carregant franges…',
		retry: 'Tornar a intentar',
		continue: 'Següent',
		next: 'Següent',
		previous: 'Enrere',
		finalize: 'Finalitzar',
		confirm: 'Confirmar',
		networkError: 'Error de xarxa. Comproveu la connexió i torneu-ho a intentar.',
		parseError: 'La resposta del proveïdor no és reconeguda.',
		invalidResponse: 'Dades de disponibilitat no vàlides.',
		invalidPreset: 'L’especialitat indicada no és vàlida. Trieu una opció de la llista.',
		noDays: 'No hi ha dies disponibles ara mateix.',
		noSlots: 'No hi ha franges per aquest dia.',
		selectSpecialty: 'Especialitat',
		selectTreatment: 'Servei',
		selectArea: 'Centre',
		areaLabel: 'Centre',
		stepsAriaLabel: 'Passos de la reserva',
		selectDay: 'Tria dia',
		selectSlot: 'Tria hora',
		selectProfessional: 'Professional',
		availabilityNotice:
			'La disponibilitat pot canviar. Ompliu les dades per enviar la sol·licitud i la clínica us confirmarà per correu o telèfon.',
		gateBlocked:
			'No es pot carregar l’agenda des d’aquest lloc (accés bloquejat). Podeu continuar al portal oficial.',
		openPortal: 'Obrir portal de reserves',
		detailsHeading: 'Dades de la reserva',
		specialtyStepDescription: 'Tria l’àrea clínica que millor s’ajusta al teu objectiu.',
		treatmentStepDescription: 'Selecciona el servei',
		treatmentNoticeLabel: 'Informació sobre la visita',
		treatmentNotice: [
			'A la primera visita fem una valoració mèdica personalitzada de les teves necessitats i objectius, i et proposem un pla amb diverses alternatives terapèutiques; si inicies algun dels tractaments proposats, l’import de la consulta es descompta del seu preu.',
			'El tractament es pot fer el mateix dia, segons la disponibilitat de l’agenda.',
		],
		areaStepDescription: 'Tria el centre on prefereixes fer la visita.',
		dateTimeStepDescription: 'Primer tria la data; després mostrarem les hores disponibles.',
		detailsStepDescription: 'Completa les dades per enviar la sol·licitud de cita.',
		summaryHeading: 'Resum',
		patientHadVisitBefore: 'Ha tingut cita abans amb la clínica?',
		modeNewPatient: 'Pacient nou',
		modeReturningPatient: 'Ja registrat',
		fieldDni: 'DNI o passaport',
		fieldBirthDate: 'Data de naixement',
		fieldName: 'Nom',
		fieldSurname: 'Cognoms',
		fieldPhonePrefix: 'Prefix telefònic',
		fieldPhone: 'Telèfon',
		fieldEmail: 'Correu electrònic',
		privacyCheckbox: 'He llegit i accepto la política de privacitat i les condicions',
		privacyRequired: 'Cal acceptar la política de privacitat per continuar.',
		fieldsRequired: 'Reviseu els camps obligatoris.',
		loadingConfirmPage: 'Carregant el formulari de confirmació…',
		confirmTitle: 'Confirmar enviament',
		confirmIntro: 'Esteu a punt de finalitzar la sol·licitud de la cita.',
		confirmBackHint:
			'Amb Enrere podreu revisar les dades. Amb Finalitzar s’enviarà la sol·licitud i la clínica us confirmarà per correu (reviseu la carpeta de correu brossa), telèfon, SMS o WhatsApp.',
		confirmSubmitHint: '',
		confirmDisclaimer:
			'La data o l’hora finals poden variar per planificació. Si teniu problemes, contacteu la clínica.',
		submitting: 'Enviant…',
		submitSuccess: 'Sol·licitud enviada correctament. Aviat us contactaran per confirmar la cita.',
		submitFailed: 'No s’ha pogut completar la reserva. Torneu-ho a intentar o feu servir el portal oficial.',
		recaptchaFailed: 'No s’ha pogut verificar reCAPTCHA. Proveu-ho des del portal oficial o més tard.',
		backToSlots: 'Tornar a triar hora',
		serviceLabel: 'Servei',
		specialtyLabel: 'Especialitat',
		treatmentLabel: 'Tractament',
		dateLabel: 'Data',
		timeLabel: 'Hora',
		locationLabel: 'Ubicació',
		appointmentDurationHint: 'Les cites solen durar entre 45 i 60 minuts.',
		bookingLegalSummaryHeading: 'Resum del tractament de dades',
		bookingLegalSummaryBody:
			'El responsable és el titular identificat a la política de privacitat. Les dades es tracten per gestionar la sol·licitud de cita i les comunicacions necessàries amb la clínica; base legal: mesures precontractuals a la vostra sol·licitud i, si escau, interès legítim en la seguretat de l’enviament. Nubimed / Clínica en el núvol actua com a encarregat seguint instruccions del responsable.',
		privacyPolicyLinkLabel: 'Política de privacitat (informació ampliada)',
		marketingCheckbox: 'Vull rebre comunicacions comercials (opcional).',
		recaptchaIntro: 'Aquest lloc està protegit per reCAPTCHA; s’apliquen la',
		recaptchaPrivacyLink: 'Política de privacitat de Google',
		recaptchaAndTerms: 'i els',
		recaptchaTermsLink: 'Termes de servei de Google',
		recaptchaLegalSuffix: '.',
	},
	fr: {
		stepLabelPrefix: 'STEP',
		loadingBootstrap: 'Préparation du planning…',
		loadingDays: 'Chargement des jours disponibles…',
		loadingSlots: 'Chargement des créneaux…',
		retry: 'Réessayer',
		continue: 'Suivant',
		next: 'Suivant',
		previous: 'Retour',
		finalize: 'Finaliser',
		confirm: 'Confirmer',
		networkError: 'Erreur réseau. Vérifiez la connexion et réessayez.',
		parseError: 'Réponse du prestataire non reconnue.',
		invalidResponse: 'Données de disponibilité non valides.',
		invalidPreset: 'La spécialité indiquée n’est pas valide. Choisissez une option dans la liste.',
		noDays: 'Aucun jour disponible pour le moment.',
		noSlots: 'Aucun créneau pour ce jour.',
		selectSpecialty: 'Spécialité',
		selectTreatment: 'Service',
		selectArea: 'Centre',
		areaLabel: 'Centre',
		stepsAriaLabel: 'Étapes de la réservation',
		selectDay: 'Choisissez le jour',
		selectSlot: 'Choisissez l’heure',
		selectProfessional: 'Praticien',
		availabilityNotice:
			'Les disponibilités peuvent varier. Veuillez compléter vos coordonnées pour soumettre votre demande ; la clinique vous confirmera votre disponibilité par courriel ou par téléphone.',
		gateBlocked:
			'Impossible de charger le planning depuis ce site (accès bloqué). Vous pouvez continuer sur le portail officiel.',
		openPortal: 'Ouvrir le portail de rendez-vous',
		detailsHeading: 'Détails de la réservation',
		specialtyStepDescription: 'Choisissez le domaine clinique le plus adapté à votre objectif.',
		treatmentStepDescription: 'Sélectionnez le service',
		treatmentNoticeLabel: 'À propos de votre visite',
		treatmentNotice: [
			'Lors de la première visite, nous réalisons une évaluation médicale personnalisée de vos besoins et de vos objectifs, et vous proposons un plan avec plusieurs options thérapeutiques ; si vous débutez l’un des traitements proposés, le montant de la consultation est déduit de son prix.',
			'Le traitement peut être réalisé le jour même, selon les disponibilités de l’agenda.',
		],
		areaStepDescription: 'Choisissez le centre où vous souhaitez être reçu(e).',
		dateTimeStepDescription: 'Choisissez d’abord une date, puis un créneau disponible.',
		detailsStepDescription: 'Complétez vos informations pour envoyer la demande de rendez-vous.',
		summaryHeading: 'Résumé',
		patientHadVisitBefore: 'Avez-vous déjà eu rendez-vous dans cette clinique ?',
		modeNewPatient: 'Nouveau patient',
		modeReturningPatient: 'Déjà enregistré',
		fieldDni: 'Pièce d’identité ou passeport',
		fieldBirthDate: 'Date de naissance',
		fieldName: 'Prénom',
		fieldSurname: 'Nom',
		fieldPhonePrefix: 'Indicatif téléphonique',
		fieldPhone: 'Téléphone',
		fieldEmail: 'E-mail',
		privacyCheckbox: 'J’ai lu et j’accepte la politique de confidentialité et les conditions',
		privacyRequired: 'Vous devez accepter la politique de confidentialité pour continuer.',
		fieldsRequired: 'Veuillez remplir tous les champs obligatoires.',
		loadingConfirmPage: 'Chargement du formulaire de confirmation…',
		confirmTitle: 'Confirmer l’envoi',
		confirmIntro: 'Vous êtes sur le point d’envoyer votre demande de rendez-vous.',
		confirmBackHint:
			'Retour permet de vérifier vos informations. Le bouton Finaliser envoie la demande ; la clinique confirmera par e-mail (vérifiez les courriers indésirables), téléphone, SMS ou WhatsApp.',
		confirmSubmitHint: '',
		confirmDisclaimer:
			'La date ou l’heure finale peuvent changer selon le planning. En cas de problème, contactez la clinique.',
		submitting: 'Envoi en cours…',
		submitSuccess: 'Demande envoyée avec succès. La clinique vous contactera bientôt pour confirmer.',
		submitFailed: 'La réservation n’a pas pu être finalisée. Réessayez ou utilisez le portail officiel.',
		recaptchaFailed: 'reCAPTCHA non vérifié. Essayez via le portail officiel ou plus tard.',
		backToSlots: 'Retour au choix de l’heure',
		serviceLabel: 'Service',
		specialtyLabel: 'Spécialité',
		treatmentLabel: 'Traitement',
		dateLabel: 'Date',
		timeLabel: 'Heure',
		locationLabel: 'Lieu',
		appointmentDurationHint: 'Les rendez-vous durent généralement 45 à 60 minutes.',
		bookingLegalSummaryHeading: 'Résumé du traitement des données',
		bookingLegalSummaryBody:
			'Le responsable est identifié dans la politique de confidentialité. Les données sont traitées pour gérer votre demande de rendez-vous et les communications nécessaires avec la clinique ; base juridique : mesures précontractuelles à votre demande et, le cas échéant, intérêt légitime à sécuriser l’envoi. Nubimed / Clinica en la nube agit en tant que sous-traitant sur instruction du responsable.',
		privacyPolicyLinkLabel: 'Politique de confidentialité (informations détaillées)',
		marketingCheckbox: 'Je souhaite recevoir des communications commerciales (facultatif).',
		recaptchaIntro: 'Ce site est protégé par reCAPTCHA ; les',
		recaptchaPrivacyLink: 'règles de confidentialité de Google',
		recaptchaAndTerms: 'et les',
		recaptchaTermsLink: 'conditions d’utilisation de Google',
		recaptchaLegalSuffix: ' s’appliquent.',
	},
};

export function t(lang: SiteLocale): BookingStrings {
	return STRINGS[lang];
}
