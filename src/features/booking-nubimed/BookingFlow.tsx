import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
	CENTROS,
	catalogEntryBySlugOrId,
	centroFor,
	FIRST_VISIT_DETAIL,
	labelFor,
	phonePrefixSelectOptions,
	SPECIALTY_CATALOG,
	TREATMENT_KIND_LABELS,
	type SpecialtyCatalogEntry,
	type SpecialtyCentro,
} from './config';
import { SERVICE_IDS } from './catalog';
import type { ServiceKind } from './catalog';
import { t } from './i18n';
import { BookingApiError, fetchAvailability, submitBookingRequest } from './client';
import type { BookingRequestBody, BookingStatus } from './api-contract';
import { formatSlotTime } from './agenda-hours';
import { compareYmd, effectiveHorizonDays, maxSelectableYmd, todayYmdMadrid } from './horizon';
import { href } from '../../i18n/route-registry';
import type { BookingFlowProps, SiteLocale, TreatmentOption } from './types';

type Phase = 'pick' | 'details' | 'success';
type PickStep = 'specialty' | 'area' | 'treatment' | 'datetime';

/** Horizonte fijo (REQ-6): el servidor ya acota la ventana; el cliente solo la respeta. */
const HORIZON_DAYS = effectiveHorizonDays(91);

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TURNSTILE_POLICY_URL = 'https://www.cloudflare.com/privacypolicy/';

interface TurnstileApi {
	render: (el: HTMLElement, opts: Record<string, unknown>) => string;
	reset: (widgetId?: string) => void;
	remove: (widgetId?: string) => void;
}

function getTurnstile(): TurnstileApi | undefined {
	if (typeof window === 'undefined') return undefined;
	return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

let turnstileScriptPromise: Promise<void> | null = null;

/** Inyecta el script de Turnstile una sola vez (solo al entrar en el paso de datos, AD-7). */
function loadTurnstileScript(): Promise<void> {
	if (typeof document === 'undefined') return Promise.reject(new Error('no document'));
	if (getTurnstile()) return Promise.resolve();
	if (turnstileScriptPromise) return turnstileScriptPromise;
	const p = new Promise<void>((resolve, reject) => {
		const s = document.createElement('script');
		s.src = TURNSTILE_SRC;
		s.async = true;
		s.defer = true;
		s.onload = () => (getTurnstile() ? resolve() : reject(new Error('turnstile unavailable')));
		s.onerror = () => {
			s.remove();
			reject(new Error('turnstile load failed'));
		};
		document.head.appendChild(s);
	});
	turnstileScriptPromise = p;
	p.catch(() => {
		turnstileScriptPromise = null;
	});
	return p;
}

function monthStartYmd(ymd: string): string {
	const [y, m] = ymd.split('-');
	return `${y}-${m}-01`;
}

function addMonthsYmd(monthStart: string, delta: number): string {
	const [y, m] = monthStart.split('-').map((v) => parseInt(v, 10));
	const d = new Date(Date.UTC(y, m - 1 + delta, 1));
	return d.toISOString().slice(0, 10);
}

function weekdayMondayFirst(ymd: string): number {
	const [y, m, d] = ymd.split('-').map((v) => parseInt(v, 10));
	const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 domingo
	return (js + 6) % 7; // 0 lunes
}

function daysInMonth(monthStart: string): number {
	const [y, m] = monthStart.split('-').map((v) => parseInt(v, 10));
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function formatMonthYear(ymd: string, lang: SiteLocale): string {
	return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : lang, {
		month: 'long',
		year: 'numeric',
	}).format(new Date(`${ymd}T12:00:00`));
}

function summaryDateLabel(ymd: string, lang: SiteLocale): string {
	return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : lang, {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).format(new Date(`${ymd}T12:00:00`));
}

/** Campos de `invalid` que invalidan la franja elegida, no un campo del formulario. */
const SLOT_FIELDS = new Set(['requestedTime', 'specialty', 'centro', 'kind']);

export default function BookingFlow({
	lang,
	presetSpecialtySlug,
	presetTreatmentId,
	centroLocations,
	turnstileSiteKey,
	whatsappHref,
}: BookingFlowProps) {
	const strings = t(lang);
	const prefixOptions = useMemo(() => phonePrefixSelectOptions(lang), [lang]);

	/** Prop from Astro is often empty on static builds; merge runtime `?preset=` from the browser URL. */
	const trimPreset = (v: string | null | undefined) => (typeof v === 'string' ? v.trim() : '');
	const [resolvedPresetSlug, setResolvedPresetSlug] = useState(() => trimPreset(presetSpecialtySlug));
	const [resolvedPresetTreatmentId, setResolvedPresetTreatmentId] = useState(() => trimPreset(presetTreatmentId));
	const [resolvedSede, setResolvedSede] = useState('');

	useLayoutEffect(() => {
		if (typeof window === 'undefined') return;
		const params = new URLSearchParams(window.location.search);
		const preset = trimPreset(presetSpecialtySlug) || trimPreset(params.get('preset'));
		if (preset) setResolvedPresetSlug((prev) => (prev === preset ? prev : preset));
		const fromUrlTreatment = trimPreset(params.get('treatment'));
		if (fromUrlTreatment) setResolvedPresetTreatmentId((prev) => (prev === fromUrlTreatment ? prev : fromUrlTreatment));
		const fromUrlSede = trimPreset(params.get('sede')).toLowerCase();
		if (fromUrlSede) setResolvedSede((prev) => (prev === fromUrlSede ? prev : fromUrlSede));
	}, [presetSpecialtySlug, presetTreatmentId]);

	const presetEntry = useMemo(() => {
		if (resolvedPresetSlug === '') return undefined;
		return catalogEntryBySlugOrId(resolvedPresetSlug);
	}, [resolvedPresetSlug]);

	const invalidSpecialtyPreset = resolvedPresetSlug !== '' && presetEntry === undefined;

	const hasValidPreset = resolvedPresetSlug !== '' && presetEntry !== undefined;
	const sedeEntry = useMemo(
		() => (presetEntry && resolvedSede ? centroFor(presetEntry, resolvedSede) : undefined),
		[presetEntry, resolvedSede],
	);
	const invalidSede = resolvedSede !== '' && hasValidPreset && !sedeEntry;
	const invalidPreset = invalidSpecialtyPreset || invalidSede;
	const showSpecialtyPicker = !hasValidPreset || invalidSpecialtyPreset;
	const showAreaPicker = !sedeEntry;
	const initialPickStep: PickStep = showSpecialtyPicker ? 'specialty' : sedeEntry ? 'treatment' : 'area';

	const [specialty, setSpecialty] = useState<SpecialtyCatalogEntry | null>(() => presetEntry ?? null);
	const [centro, setCentro] = useState<SpecialtyCentro | null>(() => sedeEntry ?? null);
	const [pickStep, setPickStep] = useState<PickStep>(initialPickStep);
	const [selectedTreatment, setSelectedTreatment] = useState<TreatmentOption | null>(null);

	useEffect(() => {
		if (!presetEntry) return;
		setSpecialty(presetEntry);
		setCentro(sedeEntry ?? null);
		setSelectedTreatment(null);
		setPickStep(initialPickStep);
	}, [presetEntry, sedeEntry, initialPickStep]);

	useEffect(() => {
		setPickStep(initialPickStep);
	}, [initialPickStep]);

	/** Opciones derivadas del catalogo (AD-2): 2 por centro, sin peticiones. `id` = serviceId del catalogo. */
	const treatmentOptions = useMemo((): TreatmentOption[] => {
		if (!specialty || !centro) return [];
		const make = (kind: ServiceKind, detail: string): TreatmentOption => ({
			id: String(SERVICE_IDS[specialty.vendorId][centro.centro][kind]),
			kind,
			label: TREATMENT_KIND_LABELS[kind][lang],
			detail,
		});
		return [make('firstVisit', FIRST_VISIT_DETAIL), make('treatments', centro.treatmentsDetail)];
	}, [specialty, centro, lang]);

	useEffect(() => {
		if (pickStep !== 'treatment' || selectedTreatment || !resolvedPresetTreatmentId || !specialty) return;
		const normalized = resolvedPresetTreatmentId.trim().toLowerCase();
		if (!normalized) return;
		const matched = treatmentOptions.find(
			(option) => option.id === normalized || `${specialty.vendorId}-${option.id}` === normalized,
		);
		if (!matched) return;
		setSelectedTreatment(matched);
		setPickStep('datetime');
	}, [pickStep, selectedTreatment, resolvedPresetTreatmentId, treatmentOptions, specialty]);

	/** Disponibilidad: una carga por (especialidad, centro, tipo); dias y franjas se derivan de ella. */
	const bookingTarget = useMemo(() => {
		if (!specialty || !centro || !selectedTreatment) return null;
		return { specialty: specialty.vendorId, centro: centro.centro, kind: selectedTreatment.kind } as const;
	}, [specialty, centro, selectedTreatment]);
	const targetKey = bookingTarget ? `${bookingTarget.specialty}|${bookingTarget.centro}|${bookingTarget.kind}` : null;

	const [availability, setAvailability] = useState<{ key: string; days: Record<string, string[]> } | null>(null);
	const [availabilityLoading, setAvailabilityLoading] = useState(false);
	const [availabilityErr, setAvailabilityErr] = useState<string | null>(null);
	const [reloadNonce, setReloadNonce] = useState(0);
	const loadedKeyRef = useRef<string | null>(null);

	const [selectedDay, setSelectedDay] = useState<string | null>(null);
	const [selectedSlotIso, setSelectedSlotIso] = useState<string | null>(null);
	const [slotNotice, setSlotNotice] = useState<string | null>(null);
	const [visibleMonthStart, setVisibleMonthStart] = useState<string | null>(null);

	const reloadAvailability = useCallback(() => {
		loadedKeyRef.current = null;
		setReloadNonce((n) => n + 1);
	}, []);

	useEffect(() => {
		if (pickStep !== 'datetime' || !bookingTarget || !targetKey) return;
		if (loadedKeyRef.current === targetKey) return;
		const ac = new AbortController();
		setAvailabilityLoading(true);
		setAvailabilityErr(null);
		void (async () => {
			try {
				const res = await fetchAvailability(ac.signal, bookingTarget);
				if (ac.signal.aborted) return;
				loadedKeyRef.current = targetKey;
				setAvailability({ key: targetKey, days: res.days });
			} catch (e) {
				if (ac.signal.aborted) return;
				setAvailability(null);
				setAvailabilityErr(e instanceof BookingApiError && e.code === 'busy' ? strings.busy : strings.networkError);
			} finally {
				if (!ac.signal.aborted) setAvailabilityLoading(false);
			}
		})();
		return () => ac.abort();
	}, [pickStep, bookingTarget, targetKey, reloadNonce, strings.busy, strings.networkError]);

	/** Solo se usa la disponibilidad que corresponde al objetivo actual (respuestas obsoletas ignoradas). */
	const dayMap = availability && availability.key === targetKey ? availability.days : null;

	const availableYmds = useMemo(() => {
		if (!dayMap) return [] as string[];
		const todayY = todayYmdMadrid();
		const maxY = maxSelectableYmd(todayY, HORIZON_DAYS);
		return Object.keys(dayMap)
			.filter((ymd) => (dayMap[ymd]?.length ?? 0) > 0 && compareYmd(ymd, todayY) >= 0 && compareYmd(ymd, maxY) <= 0)
			.sort(compareYmd);
	}, [dayMap]);
	const availableSet = useMemo(() => new Set(availableYmds), [availableYmds]);
	const slots = useMemo(() => (dayMap && selectedDay ? (dayMap[selectedDay] ?? []) : []), [dayMap, selectedDay]);

	const [phase, setPhase] = useState<Phase>('pick');
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [npNombre, setNpNombre] = useState('');
	const [npApellidos, setNpApellidos] = useState('');
	const [npPrefijo, setNpPrefijo] = useState('34');
	const [npTel, setNpTel] = useState('');
	const [npEmail, setNpEmail] = useState('');
	const [comments, setComments] = useState('');
	const [website, setWebsite] = useState('');
	const [privacyOk, setPrivacyOk] = useState(false);
	const [validationErr, setValidationErr] = useState<string | null>(null);
	const [invalidFields, setInvalidFields] = useState<readonly string[]>([]);
	const [submitErr, setSubmitErr] = useState<string | null>(null);
	const [showContactFallback, setShowContactFallback] = useState(false);
	const [submitting, setSubmitting] = useState(false);
	const [unknownSent, setUnknownSent] = useState(false);
	const [successStatus, setSuccessStatus] = useState<BookingStatus>('received');

	const [turnstileReady, setTurnstileReady] = useState(false);
	const [turnstileLoadFailed, setTurnstileLoadFailed] = useState(false);
	const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
	const turnstileElRef = useRef<HTMLDivElement | null>(null);
	const turnstileWidgetRef = useRef<string | null>(null);
	const turnstileUnavailable = !turnstileSiteKey || turnstileLoadFailed;

	/** Turnstile: el script se carga solo al entrar en el paso de datos (no en la carga de pagina). */
	useEffect(() => {
		if (phase !== 'details') return;
		if (!turnstileSiteKey) return;
		let cancelled = false;
		loadTurnstileScript().then(
			() => {
				if (!cancelled) setTurnstileReady(true);
			},
			() => {
				if (!cancelled) setTurnstileLoadFailed(true);
			},
		);
		return () => {
			cancelled = true;
		};
	}, [phase, turnstileSiteKey]);

	/** El widget se renderiza al abrir el modal y se elimina al cerrarlo. */
	useEffect(() => {
		if (!confirmOpen || !turnstileReady || !turnstileSiteKey) return;
		const el = turnstileElRef.current;
		const api = getTurnstile();
		if (!el || !api) return;
		try {
			const id = api.render(el, {
				sitekey: turnstileSiteKey,
				action: 'booking',
				appearance: 'interaction-only',
				callback: (token: string) => setTurnstileToken(token),
				'error-callback': () => {
					setTurnstileToken(null);
					setTurnstileLoadFailed(true);
				},
				'expired-callback': () => setTurnstileToken(null),
			});
			turnstileWidgetRef.current = id;
		} catch {
			setTurnstileLoadFailed(true);
			return;
		}
		return () => {
			const id = turnstileWidgetRef.current;
			turnstileWidgetRef.current = null;
			setTurnstileToken(null);
			if (id) {
				try {
					api.remove(id);
				} catch {
					/* widget ya eliminado */
				}
			}
		};
	}, [confirmOpen, turnstileReady, turnstileSiteKey]);

	const datetimeBodyRef = useRef<HTMLDivElement | null>(null);
	const slotsPaneRef = useRef<HTMLDivElement | null>(null);
	const detailsScrollRef = useRef<HTMLDivElement | null>(null);
	const emailFieldWrapRef = useRef<HTMLLabelElement | null>(null);

	/** Píxeles de aire por encima del panel de horas dentro del scroll de `.datetime-body` (móvil). */
	const MOBILE_SLOTS_SCROLL_INSET_PX = 5;

	/** Píxeles de aire por encima del campo correo dentro de `.booking-flow__details-scroll` (móvil). */
	const MOBILE_EMAIL_SCROLL_INSET_PX = 8;

	const scrollMobileSlotsPaneIntoView = useCallback(() => {
		const win = typeof globalThis !== 'undefined' && 'window' in globalThis ? globalThis.window : undefined;
		if (!win?.matchMedia?.('(max-width: 899px)')?.matches) return;
		const pane = slotsPaneRef.current;
		const scrollRoot = datetimeBodyRef.current;
		if (!pane || !scrollRoot) return;
		const instant = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const rootRect = scrollRoot.getBoundingClientRect();
		const paneRect = pane.getBoundingClientRect();
		const delta = paneRect.top - rootRect.top;
		const rawTarget = scrollRoot.scrollTop + delta - MOBILE_SLOTS_SCROLL_INSET_PX;
		const maxScroll = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
		const top = Math.min(Math.max(0, rawTarget), maxScroll);
		scrollRoot.scrollTo({ top, behavior: instant ? 'auto' : 'smooth' });
	}, []);

	const scrollMobileEmailFieldIntoView = useCallback(() => {
		const win = typeof globalThis !== 'undefined' && 'window' in globalThis ? globalThis.window : undefined;
		if (!win?.matchMedia?.('(max-width: 899px)')?.matches) return;
		const scrollRoot = detailsScrollRef.current;
		const target = emailFieldWrapRef.current;
		if (!scrollRoot || !target) return;
		const instant = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
		const rootRect = scrollRoot.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		const delta = targetRect.top - rootRect.top;
		const rawTarget = scrollRoot.scrollTop + delta - MOBILE_EMAIL_SCROLL_INSET_PX;
		const maxScroll = Math.max(0, scrollRoot.scrollHeight - scrollRoot.clientHeight);
		const top = Math.min(Math.max(0, rawTarget), maxScroll);
		scrollRoot.scrollTo({ top, behavior: instant ? 'auto' : 'smooth' });
	}, []);

	useEffect(() => {
		if (availableYmds.length === 0) {
			setVisibleMonthStart(null);
			return;
		}
		const target = selectedDay && availableSet.has(selectedDay) ? selectedDay : availableYmds[0];
		setVisibleMonthStart(monthStartYmd(target));
	}, [availableYmds, selectedDay, availableSet]);

	const minMonthStart = availableYmds.length > 0 ? monthStartYmd(availableYmds[0]) : null;
	const maxMonthStart =
		availableYmds.length > 0 ? monthStartYmd(availableYmds[availableYmds.length - 1]) : null;

	const canPrevMonth =
		!!visibleMonthStart && !!minMonthStart && compareYmd(visibleMonthStart, minMonthStart) > 0;
	const canNextMonth =
		!!visibleMonthStart && !!maxMonthStart && compareYmd(visibleMonthStart, maxMonthStart) < 0;

	const calendarCells = useMemo(() => {
		if (!visibleMonthStart) return [] as Array<{ key: string; ymd: string | null }>;
		const firstOffset = weekdayMondayFirst(visibleMonthStart);
		const totalDays = daysInMonth(visibleMonthStart);
		const cells: Array<{ key: string; ymd: string | null }> = [];
		for (let i = 0; i < firstOffset; i += 1) {
			cells.push({ key: `blank-${i}`, ymd: null });
		}
		for (let d = 1; d <= totalDays; d += 1) {
			const ymd = `${visibleMonthStart.slice(0, 8)}${String(d).padStart(2, '0')}`;
			cells.push({ key: ymd, ymd });
		}
		return cells;
	}, [visibleMonthStart]);

	/** Limpia día/franja (estado descendente de la disponibilidad). */
	const clearDateSelection = () => {
		setSelectedDay(null);
		setSelectedSlotIso(null);
		setSlotNotice(null);
	};

	const onSpecialtyChange = (spec: SpecialtyCatalogEntry) => {
		setSpecialty(spec);
		setCentro(null);
		setSelectedTreatment(null);
		clearDateSelection();
		setPickStep('area');
		setPhase('pick');
		setConfirmOpen(false);
	};

	const onCentroPick = (c: SpecialtyCentro) => {
		setCentro(c);
		setSelectedTreatment(null);
		clearDateSelection();
		setPickStep('treatment');
	};

	const onDayPick = (ymd: string) => {
		setSelectedDay(ymd);
		setSelectedSlotIso(null);
		setSlotNotice(null);
		queueMicrotask(() => {
			requestAnimationFrame(() => {
				requestAnimationFrame(scrollMobileSlotsPaneIntoView);
			});
		});
	};

	/** Elegir hora avanza directamente al paso de datos (REQ-9). */
	const onSlotPick = (iso: string) => {
		setSelectedSlotIso(iso);
		setSlotNotice(null);
		setValidationErr(null);
		setSubmitErr(null);
		setPhase('details');
	};

	const onTreatmentPick = (treatment: TreatmentOption) => {
		setSelectedTreatment(treatment);
		clearDateSelection();
		setPickStep('datetime');
	};

	const onBackToSpecialty = () => {
		setSelectedTreatment(null);
		clearDateSelection();
		setPickStep('specialty');
	};

	const onBackToArea = () => {
		setSelectedTreatment(null);
		clearDateSelection();
		setPickStep('area');
	};

	const onBackFromTreatment = () => {
		if (showAreaPicker) onBackToArea();
		else onBackToSpecialty();
	};

	const onBackToTreatment = () => {
		clearDateSelection();
		setPickStep('treatment');
	};

	const resetAfterSuccess = () => {
		setPhase('pick');
		setPickStep(initialPickStep);
		setCentro(sedeEntry ?? null);
		setConfirmOpen(false);
		setSelectedTreatment(null);
		clearDateSelection();
		setAvailability(null);
		loadedKeyRef.current = null;
		setPrivacyOk(false);
		setValidationErr(null);
		setInvalidFields([]);
		setSubmitErr(null);
		setShowContactFallback(false);
		setUnknownSent(false);
		setNpNombre('');
		setNpApellidos('');
		setNpPrefijo('34');
		setNpTel('');
		setNpEmail('');
		setComments('');
		setWebsite('');
	};

	const onBackFromDetails = () => {
		setPhase('pick');
		setPickStep('datetime');
		setConfirmOpen(false);
		setValidationErr(null);
		setInvalidFields([]);
		setSubmitErr(null);
	};

	const validatePatientFields = (): boolean => {
		const missing: string[] = [];
		if (!npNombre.trim()) missing.push('name');
		if (!npApellidos.trim()) missing.push('surname');
		if (!npTel.trim()) missing.push('phone');
		if (!npEmail.trim()) missing.push('email');
		if (missing.length > 0) {
			setInvalidFields(missing);
			setValidationErr(strings.fieldsRequired);
			return false;
		}
		setInvalidFields([]);
		setValidationErr(null);
		return true;
	};

	const onOpenConfirm = () => {
		if (!validatePatientFields()) return;
		setSubmitErr(null);
		setShowContactFallback(false);
		setConfirmOpen(true);
	};

	/** Token de un solo uso: se reinicia tras cualquier respuesta del POST. */
	const resetTurnstile = () => {
		setTurnstileToken(null);
		const id = turnstileWidgetRef.current;
		const api = getTurnstile();
		if (id && api) {
			try {
				api.reset(id);
			} catch {
				/* widget ya eliminado */
			}
		}
	};

	/** Errores por `code`, nunca por subcadenas (AD-6). */
	const handleApiError = (e: BookingApiError) => {
		switch (e.code) {
			case 'busy':
				setSubmitErr(strings.busy);
				break;
			case 'slot_unavailable':
				goBackToTimeStep();
				break;
			case 'invalid': {
				const fields = e.fields ?? [];
				if (fields.some((f) => SLOT_FIELDS.has(f))) {
					goBackToTimeStep();
					break;
				}
				setConfirmOpen(false);
				setInvalidFields(fields);
				setValidationErr(fields.includes('consent') ? strings.privacyRequired : strings.fieldsRequired);
				break;
			}
			case 'turnstile_failed':
				setSubmitErr(strings.turnstileFailed);
				setShowContactFallback(true);
				break;
			case 'unknown':
				setUnknownSent(true);
				setSubmitErr(strings.submitUnknown);
				setShowContactFallback(true);
				break;
			default:
				// config / upstream / forbidden
				setSubmitErr(strings.submitGenericError);
				setShowContactFallback(true);
		}
	};

	/** `slot_unavailable`: refrescar disponibilidad y volver a elegir franja. */
	const goBackToTimeStep = () => {
		setConfirmOpen(false);
		setSelectedSlotIso(null);
		setSlotNotice(strings.slotUnavailable);
		setPhase('pick');
		setPickStep('datetime');
		reloadAvailability();
	};

	const onFinalize = async () => {
		if (!privacyOk) {
			setSubmitErr(strings.privacyRequired);
			return;
		}
		if (!specialty || !centro || !selectedTreatment || !selectedSlotIso) return;
		if (!turnstileToken || unknownSent) return;
		if (!validatePatientFields()) {
			setConfirmOpen(false);
			return;
		}
		const body: BookingRequestBody = {
			specialty: specialty.vendorId,
			centro: centro.centro,
			kind: selectedTreatment.kind,
			requestedTime: selectedSlotIso,
			patient: {
				name: npNombre.trim(),
				surname: npApellidos.trim(),
				phonePrefix: npPrefijo,
				phone: npTel.trim(),
				email: npEmail.trim(),
			},
			...(comments.trim() ? { comments: comments.trim() } : {}),
			consent: true,
			turnstileToken,
			...(website ? { website } : {}),
		};
		setSubmitting(true);
		setSubmitErr(null);
		setShowContactFallback(false);
		const ac = new AbortController();
		try {
			const res = await submitBookingRequest(ac.signal, body);
			setSuccessStatus(res.status);
			setConfirmOpen(false);
			setPhase('success');
		} catch (e) {
			if (e instanceof BookingApiError) handleApiError(e);
			else setSubmitErr(strings.submitGenericError);
		} finally {
			resetTurnstile();
			setSubmitting(false);
		}
	};

	if (phase === 'success') {
		return (
			<div class="booking-flow booking-flow--success" role="status">
				<p class="booking-flow__success-msg">
					{successStatus === 'confirmed' ? strings.submitSuccessConfirmed : strings.submitSuccessReceived}
				</p>
				<button type="button" class="booking-flow__continue" onClick={resetAfterSuccess}>
					{strings.backToSlots}
				</button>
			</div>
		);
	}

	const activeStepIndex =
		phase === 'details'
		? 5
		: pickStep === 'specialty'
			? 1
			: pickStep === 'area'
				? 2
				: pickStep === 'treatment'
					? 3
					: 4;
	const centroLocation = centro ? centroLocations?.[centro.centro] : undefined;
	const centroAddressText = centroLocation ? centroLocation.address.replace(/\n/g, ', ') : '';
	const stepLabel = (step: number) => `${strings.stepLabelPrefix} ${String(step).padStart(2, '0')}`;
	const fieldClass = (field: string) =>
		invalidFields.includes(field) ? 'booking-flow__input is-invalid' : 'booking-flow__input';

	const contactFallback = (
		<p class="booking-flow__captcha-fallback">
			{whatsappHref ? (
				<>
					<a href={whatsappHref} target="_blank" rel="noopener noreferrer">
						{strings.contactWhatsappLabel}
					</a>
					{' · '}
				</>
			) : null}
			<a href={href(lang, 'contact')}>{strings.contactPageLabel}</a>
		</p>
	);

	return (
		<div class="booking-flow-shell">
			<ol class="booking-flow__progress" aria-label={strings.stepsAriaLabel}>
				{[1, 2, 3, 4, 5].map((step) => (
					<li class={step <= activeStepIndex ? 'is-active' : undefined} key={step}>
						<span aria-hidden="true" />
					</li>
				))}
			</ol>
			<div class="booking-flow">
				{invalidPreset ? (
					<p class="booking-flow__banner" role="alert">
						{strings.invalidPreset}
					</p>
				) : null}

				<div class="booking-flow__step-viewport">
				{phase === 'pick' && pickStep === 'specialty' && showSpecialtyPicker ? (
					<fieldset class="booking-flow__fieldset booking-flow__step-fill">
						<legend class="booking-flow__legend booking-flow__legend--split">
							<span class="booking-flow__step-kicker">{stepLabel(1)}</span>
							<div class="booking-flow__legend-row">
								<span class="booking-flow__h">{strings.selectSpecialty}</span>
								<span class="booking-flow__step-description booking-flow__step-description--legend">
									{strings.specialtyStepDescription}
								</span>
							</div>
						</legend>
						<div class="booking-flow__scroll-region">
							<ul class="booking-flow__list booking-flow__list--cards">
								{SPECIALTY_CATALOG.map((e) => (
									<li key={e.vendorId}>
										<button
											type="button"
											class={specialty?.vendorId === e.vendorId ? 'booking-flow__choice is-active' : 'booking-flow__choice'}
											onClick={() => onSpecialtyChange(e)}
										>
											{labelFor(e, lang)}
										</button>
									</li>
								))}
							</ul>
						</div>
					</fieldset>
				) : null}

				{specialty && phase === 'pick' && pickStep === 'area' && showAreaPicker ? (
					<fieldset class="booking-flow__fieldset booking-flow__step-fill">
						<legend class="booking-flow__legend booking-flow__legend--split">
							<span class="booking-flow__step-kicker">{stepLabel(2)}</span>
							<div class="booking-flow__legend-row">
								<span class="booking-flow__h">{strings.selectArea}</span>
								<span class="booking-flow__step-description booking-flow__step-description--legend">
									{strings.areaStepDescription}
								</span>
							</div>
						</legend>
						<div class="booking-flow__scroll-region">
							<ul class="booking-flow__list booking-flow__list--cards">
								{specialty.centros.map((c) => (
									<li key={c.centro}>
										<button
											type="button"
											class={centro?.centro === c.centro ? 'booking-flow__choice is-active' : 'booking-flow__choice'}
											onClick={() => onCentroPick(c)}
										>
											{CENTROS[c.centro].labels[lang]}
										</button>
									</li>
								))}
							</ul>
						</div>
						{showSpecialtyPicker ? (
							<div class="booking-flow__actions">
								<button type="button" class="booking-flow__btn-secondary" onClick={onBackToSpecialty}>
									{strings.previous}
								</button>
							</div>
						) : null}
					</fieldset>
				) : null}

				{specialty && phase === 'pick' && pickStep === 'treatment' ? (
					<section class="booking-flow__section booking-flow__step-fill" aria-labelledby="booking-treatment-h">
						<div class="booking-flow__section-head">
							<span class="booking-flow__step-kicker">{stepLabel(3)}</span>
							<div class="booking-flow__legend-row booking-flow__legend-row--split">
								<h2 id="booking-treatment-h" class="booking-flow__h">
									{strings.selectTreatment}
								</h2>
								<p class="booking-flow__step-description booking-flow__step-description--legend">
									{strings.treatmentStepDescription}
								</p>
							</div>
						</div>
						{treatmentOptions.length === 0 ? (
							<p class="booking-flow__banner" role="alert">
								{strings.noSlots}
							</p>
						) : (
							<div class="booking-flow__scroll-region">
								<ul class="booking-flow__list booking-flow__list--cards">
									{treatmentOptions.map((option) => (
										<li key={option.id}>
											<button
												type="button"
												class={
													selectedTreatment?.id === option.id
														? 'booking-flow__slot booking-flow__slot--treatment is-active'
														: 'booking-flow__slot booking-flow__slot--treatment'
												}
												onClick={() => onTreatmentPick(option)}
											>
												<span class="booking-flow__slot-label">{option.label}</span>
												<span class="booking-flow__slot-detail">{option.detail}</span>
											</button>
										</li>
									))}
								</ul>
							</div>
						)}
						<aside class="booking-flow__visit-notice" aria-label={strings.treatmentNoticeLabel}>
							<ul class="booking-flow__visit-notice-list">
								{strings.treatmentNotice.map((line) => (
									<li key={line}>{line}</li>
								))}
							</ul>
						</aside>
						{showAreaPicker || showSpecialtyPicker ? (
							<div class="booking-flow__actions">
								<button type="button" class="booking-flow__btn-secondary" onClick={onBackFromTreatment}>
									{strings.previous}
								</button>
							</div>
						) : null}
					</section>
				) : null}

			{specialty && phase === 'pick' && pickStep === 'datetime' ? (
				<div class="booking-flow__datetime-step booking-flow__step-fill">
					<section
						class="booking-flow__section booking-flow__section--datetime booking-flow__datetime-step-main"
						aria-labelledby="booking-days-h"
					>
						<span class="booking-flow__step-kicker">{stepLabel(4)}</span>
						<div class="booking-flow__datetime-body" ref={datetimeBodyRef}>
							{slotNotice ? (
								<p class="booking-flow__banner" role="alert">
									{slotNotice}
								</p>
							) : null}
							{availabilityLoading ? <p>{strings.loadingDays}</p> : null}
							{availabilityErr ? (
								<div role="alert">
									<p>{availabilityErr}</p>
									<button type="button" class="booking-flow__retry" onClick={reloadAvailability}>
										{strings.retry}
									</button>
								</div>
							) : null}
							{!availabilityLoading && !availabilityErr && dayMap && availableYmds.length === 0 ? (
								<p>{strings.noDays}</p>
							) : null}
							{!availabilityLoading && !availabilityErr && availableYmds.length > 0 && visibleMonthStart ? (
								<div class="booking-flow__datetime-layout">
								<div class="booking-flow__calendar">
									<section class="booking-flow__calendar-section booking-flow__calendar-section--title">
										<h2 id="booking-days-h" class="booking-flow__h">
											{strings.selectDay}
										</h2>
										<div class="booking-flow__calendar-section booking-flow__calendar-section--grid">
											<div class="booking-flow__calendar-header">
												<button
													type="button"
													class="booking-flow__btn-secondary"
													disabled={!canPrevMonth}
													onClick={() =>
														setVisibleMonthStart((prev) =>
															prev ? addMonthsYmd(prev, -1) : prev,
														)
													}
												>
													{`<`}
												</button>
												<span class="booking-flow__calendar-title">
													{formatMonthYear(visibleMonthStart, lang)}
												</span>
												<button
													type="button"
													class="booking-flow__btn-secondary"
													disabled={!canNextMonth}
													onClick={() =>
														setVisibleMonthStart((prev) =>
															prev ? addMonthsYmd(prev, 1) : prev,
														)
													}
												>
													{`>`}
												</button>
											</div>
											<div class="booking-flow__calendar-weekdays">
												{['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((w) => (
													<span key={w}>{w}</span>
												))}
											</div>
											<div class="booking-flow__calendar-grid">
												{calendarCells.map((cell) => {
													if (!cell.ymd) return <span key={cell.key} class="booking-flow__calendar-empty" />;
													const ymd = cell.ymd;
													const isAvailable = availableSet.has(ymd);
													const isSelected = selectedDay === ymd;
													return (
														<button
															key={cell.key}
															type="button"
															disabled={!isAvailable}
															class={
																isSelected
																	? 'booking-flow__calendar-day is-active'
																	: isAvailable
																		? 'booking-flow__calendar-day is-available'
																		: 'booking-flow__calendar-day'
															}
															onClick={() => {
																if (!isAvailable) return;
																onDayPick(ymd);
															}}
														>
															{parseInt(ymd.slice(-2), 10)}
														</button>
													);
												})}
											</div>
										</div>
									</section>
								</div>

								<div class="booking-flow__slots-pane" ref={slotsPaneRef}>
									<section class="booking-flow__section booking-flow__slots-section" aria-labelledby="booking-slots-h">
										<h2 id="booking-slots-h" class="booking-flow__h">
											{strings.selectSlot}
										</h2>
										<div class="booking-flow__slots-scroll">
											{selectedDay ? (
												<>
													{slots.length === 0 ? <p>{strings.noSlots}</p> : null}
													{slots.length > 0 ? (
														<ul class="booking-flow__slots booking-flow__slots--grid">
															{slots.map((iso) => (
																<li key={iso}>
																	<button
																		type="button"
																		class={
																			selectedSlotIso === iso
																				? 'booking-flow__slot is-active'
																				: 'booking-flow__slot'
																		}
																		onClick={() => onSlotPick(iso)}
																	>
																		{formatSlotTime(iso)}
																	</button>
																</li>
															))}
														</ul>
													) : null}
												</>
											) : null}
										</div>
									</section>
								</div>
								</div>
							) : null}
						</div>
					</section>

					<div class="booking-flow__actions">
						<button type="button" class="booking-flow__btn-secondary" onClick={onBackToTreatment}>
							{strings.previous}
						</button>
					</div>
				</div>
			) : null}

			{specialty && phase === 'details' && selectedSlotIso && selectedDay ? (
				<section class="booking-flow__details booking-flow__step-fill" aria-labelledby="booking-details-h">
					<div class="booking-flow__section-head">
						<span class="booking-flow__step-kicker">{stepLabel(5)}</span>
						<h2 id="booking-details-h" class="booking-flow__h">
							{strings.detailsHeading}
						</h2>
					</div>

					<div class="booking-flow__details-scroll" ref={detailsScrollRef}>
					<div class="booking-flow__details-layout">
						<div>
							<div class="booking-flow__grid booking-flow__grid--two-cols">
								<label class="booking-flow__field">
									<span>{strings.fieldName}</span>
									<input
										class={fieldClass('name')}
										value={npNombre}
										maxLength={80}
										onInput={(e) => setNpNombre((e.target as HTMLInputElement).value)}
										autocomplete="given-name"
										aria-invalid={invalidFields.includes('name') || undefined}
									/>
								</label>
								<label class="booking-flow__field">
									<span>{strings.fieldSurname}</span>
									<input
										class={fieldClass('surname')}
										value={npApellidos}
										maxLength={80}
										onInput={(e) => setNpApellidos((e.target as HTMLInputElement).value)}
										autocomplete="family-name"
										aria-invalid={invalidFields.includes('surname') || undefined}
									/>
								</label>
								<label class="booking-flow__field">
									<span>{strings.fieldPhonePrefix}</span>
									<select
										class="booking-flow__input booking-flow__select"
										value={npPrefijo}
										onChange={(e) => setNpPrefijo((e.target as HTMLSelectElement).value)}
										autocomplete="tel-country-code"
									>
										{prefixOptions.map((opt) => (
											<option key={opt.value} value={opt.value}>
												{opt.label}
											</option>
										))}
									</select>
								</label>
								<label class="booking-flow__field">
									<span>{strings.fieldPhone}</span>
									<input
										type="tel"
										class={fieldClass('phone')}
										value={npTel}
										onInput={(e) => setNpTel((e.target as HTMLInputElement).value)}
										autocomplete="tel-national"
										aria-invalid={invalidFields.includes('phone') || invalidFields.includes('phonePrefix') || undefined}
									/>
								</label>
								<label ref={emailFieldWrapRef} class="booking-flow__field booking-flow__field--full">
									<span>{strings.fieldEmail}</span>
									<input
										type="email"
										class={fieldClass('email')}
										value={npEmail}
										onFocus={scrollMobileEmailFieldIntoView}
										onInput={(e) => setNpEmail((e.target as HTMLInputElement).value)}
										autocomplete="email"
										aria-invalid={invalidFields.includes('email') || undefined}
									/>
								</label>
								<label class="booking-flow__field booking-flow__field--full">
									<span>{strings.fieldComments}</span>
									<textarea
										class={`${fieldClass('comments')} booking-flow__textarea`}
										value={comments}
										maxLength={500}
										rows={3}
										onInput={(e) => setComments((e.target as HTMLTextAreaElement).value)}
										aria-invalid={invalidFields.includes('comments') || undefined}
									/>
									<small class="booking-flow__field-hint">{strings.commentsHealthNotice}</small>
								</label>
								<div class="booking-flow__hp" aria-hidden="true">
									<input
										type="text"
										name="website"
										tabIndex={-1}
										autocomplete="off"
										value={website}
										onInput={(e) => setWebsite((e.target as HTMLInputElement).value)}
									/>
								</div>
							</div>

							{validationErr ? (
								<p class="booking-flow__banner" role="alert">
									{validationErr}
								</p>
							) : null}
						</div>

						<div class="booking-flow__summary booking-flow__panel">
							<h3 class="booking-flow__subh">{strings.summaryHeading}</h3>
							<div class="booking-flow__summary-lines">
								<p class="booking-flow__summary-row">
									<strong class="booking-flow__summary-label">{strings.serviceLabel}:</strong>
									<span class="booking-flow__summary-value">
										{labelFor(specialty, lang)}
										<br />
										<em>{selectedTreatment?.label ?? labelFor(specialty, lang)}</em>
									</span>
								</p>
								{centro ? (
									<p class="booking-flow__summary-row">
										<strong class="booking-flow__summary-label">{strings.areaLabel}:</strong>
										<span class="booking-flow__summary-value">{CENTROS[centro.centro].labels[lang]}</span>
									</p>
								) : null}
								<p class="booking-flow__summary-row">
									<strong class="booking-flow__summary-label">{strings.dateLabel}:</strong>
									<span class="booking-flow__summary-value">{summaryDateLabel(selectedDay, lang)}</span>
								</p>
								<p class="booking-flow__summary-row">
									<strong class="booking-flow__summary-label">{strings.timeLabel}:</strong>
									<span class="booking-flow__summary-value">{formatSlotTime(selectedSlotIso)}</span>
								</p>
								{centroLocation ? (
									<p class="booking-flow__summary-row">
										<strong class="booking-flow__summary-label">{strings.locationLabel}:</strong>
										<span class="booking-flow__summary-value">
											<a
												class="booking-flow__summary-link"
												href={centroLocation.mapsHref}
												target="_blank"
												rel="noopener noreferrer"
												aria-label={`${centroAddressText} — ${strings.openInMaps}`}
											>
												{centroAddressText}
											</a>
										</span>
									</p>
								) : null}
							</div>
							<div class="booking-flow__actions">
								<button type="button" class="booking-flow__continue" onClick={onOpenConfirm}>
									{strings.confirm}
								</button>
							</div>
						</div>
					</div>
					</div>
					<div class="booking-flow__actions">
						<button type="button" class="booking-flow__btn-secondary" onClick={onBackFromDetails}>
							{strings.previous}
						</button>
					</div>
				</section>
			) : null}
				</div>

				{confirmOpen ? (
				<div
					class="booking-flow__modal-overlay"
					role="presentation"
					onMouseDown={(e) => {
						if (e.target === e.currentTarget && !submitting) setConfirmOpen(false);
					}}
				>
					<div class="booking-flow__modal" role="dialog" aria-modal="true" aria-labelledby="booking-confirm-h">
						<h2 id="booking-confirm-h" class="booking-flow__h">
							{strings.confirmTitle}
						</h2>
						<p>{strings.confirmIntro}</p>
						<p>{strings.confirmBackHint}</p>
						<p class="booking-flow__notice">{strings.confirmDisclaimer}</p>
						<div class="booking-flow__legal-block">
							<h3 class="booking-flow__legal-block-title">{strings.bookingLegalSummaryHeading}</h3>
							<p class="booking-flow__legal-summary-body">{strings.bookingLegalSummaryBody}</p>
							<p class="booking-flow__legal-policy-link">
								<a href={`/${lang}/privacidad/`} target="_blank" rel="noopener noreferrer">
									{strings.privacyPolicyLinkLabel}
								</a>
							</p>
						</div>
						<label class="booking-flow__choice booking-flow__privacy">
							<input type="checkbox" checked={privacyOk} onChange={(e) => setPrivacyOk((e.target as HTMLInputElement).checked)} />
							<span>{strings.privacyCheckbox}</span>
						</label>
						{submitErr ? (
							<p class="booking-flow__banner booking-flow__banner--compact" role="alert">
								{submitErr}
							</p>
						) : null}
						{showContactFallback || turnstileUnavailable ? (
							<>
								{turnstileUnavailable && !submitErr ? (
									<p class="booking-flow__banner booking-flow__banner--compact" role="alert">
										{strings.turnstileFailed}
									</p>
								) : null}
								{contactFallback}
							</>
						) : null}
						<div class="booking-flow__captcha-wrap">
							<div class="booking-flow__captcha-widget" ref={turnstileElRef} />
							<p class="booking-flow__notice booking-flow__captcha-disclosure">
								{strings.turnstileNotice}{' '}
								<a href={TURNSTILE_POLICY_URL} target="_blank" rel="noopener noreferrer">
									{strings.turnstilePolicyLinkLabel}
								</a>
							</p>
						</div>
						<div class="booking-flow__actions booking-flow__actions--split">
							<button type="button" class="booking-flow__btn-secondary" disabled={submitting} onClick={() => setConfirmOpen(false)}>
								{strings.previous}
							</button>
							<button
								type="button"
								class="booking-flow__continue"
								disabled={submitting || !turnstileToken || turnstileUnavailable || unknownSent}
								onClick={() => void onFinalize()}
							>
								{submitting ? strings.submitting : strings.finalize}
							</button>
						</div>
					</div>
				</div>
				) : null}
			</div>
		</div>
	);
}
