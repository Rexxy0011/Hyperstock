import { useState, useEffect } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { FcGoogle } from "react-icons/fc";
import { FiLock, FiMail, FiUser, FiKey, FiInfo, FiCheck } from "react-icons/fi";
import { get } from "../lib/api";
import CodeForm from "../components/auth/CodeForm";
import LegalModal from "../components/auth/LegalModal";
import { Navigate, useSearchParams } from "react-router-dom";
import Link from "../components/ui/Link";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import SegmentedControl from "../components/ui/SegmentedControl";
import Logo from "../components/ui/Logo";
import { useAuth } from "../auth/AuthProvider";
import { WELCOME, withWelcome } from "../components/auth/WelcomeNotice";
import PasswordStrengthMeter from "../components/auth/PasswordStrengthMeter";
import { ADMIN_HOME } from "../components/nav/navItems";
import notify from "../lib/toast";
import { errorMessage } from "../lib/apiError";
import { generateStrongPassword, isStrongPassword } from "../lib/password";

/**
 * THE VALUE IS STABLE, THE LABEL IS TRANSLATED, and separating them was a fix
 * rather than tidying. This used to be `['Sign in', 'Create account']`, doing
 * double duty as both the button text and the state, so `mode === MODES[1]`
 * compared a stored English string against whatever the control displayed.
 * Translating the labels in place would have made that comparison fail the
 * moment somebody changed language with the form open: `mode` still held the
 * old language's string, nothing matched, and the page silently dropped back
 * to Sign in with the typed details gone.
 *
 * Same reasoning as `navItems.js` carrying `key` apart from `label` — a value
 * derived from English copy breaks when the copy is reworded or translated.
 */
const COUNTRIES = [
  {
    value: "AF",
    label: "Afghanistan",
  },
  {
    value: "AX",
    label: "Åland Islands",
  },
  {
    value: "AL",
    label: "Albania",
  },
  {
    value: "DZ",
    label: "Algeria",
  },
  {
    value: "AS",
    label: "American Samoa",
  },
  {
    value: "AD",
    label: "Andorra",
  },
  {
    value: "AO",
    label: "Angola",
  },
  {
    value: "AI",
    label: "Anguilla",
  },
  {
    value: "AQ",
    label: "Antarctica",
  },
  {
    value: "AG",
    label: "Antigua & Barbuda",
  },
  {
    value: "AR",
    label: "Argentina",
  },
  {
    value: "AM",
    label: "Armenia",
  },
  {
    value: "AW",
    label: "Aruba",
  },
  {
    value: "AU",
    label: "Australia",
  },
  {
    value: "AT",
    label: "Austria",
  },
  {
    value: "AZ",
    label: "Azerbaijan",
  },
  {
    value: "BS",
    label: "Bahamas",
  },
  {
    value: "BH",
    label: "Bahrain",
  },
  {
    value: "BD",
    label: "Bangladesh",
  },
  {
    value: "BB",
    label: "Barbados",
  },
  {
    value: "BY",
    label: "Belarus",
  },
  {
    value: "BE",
    label: "Belgium",
  },
  {
    value: "BZ",
    label: "Belize",
  },
  {
    value: "BJ",
    label: "Benin",
  },
  {
    value: "BM",
    label: "Bermuda",
  },
  {
    value: "BT",
    label: "Bhutan",
  },
  {
    value: "BO",
    label: "Bolivia",
  },
  {
    value: "BA",
    label: "Bosnia & Herzegovina",
  },
  {
    value: "BW",
    label: "Botswana",
  },
  {
    value: "BV",
    label: "Bouvet Island",
  },
  {
    value: "BR",
    label: "Brazil",
  },
  {
    value: "IO",
    label: "British Indian Ocean Territory",
  },
  {
    value: "VG",
    label: "British Virgin Islands",
  },
  {
    value: "BN",
    label: "Brunei",
  },
  {
    value: "BG",
    label: "Bulgaria",
  },
  {
    value: "BF",
    label: "Burkina Faso",
  },
  {
    value: "BI",
    label: "Burundi",
  },
  {
    value: "KH",
    label: "Cambodia",
  },
  {
    value: "CM",
    label: "Cameroon",
  },
  {
    value: "CA",
    label: "Canada",
  },
  {
    value: "CV",
    label: "Cape Verde",
  },
  {
    value: "BQ",
    label: "Caribbean Netherlands",
  },
  {
    value: "KY",
    label: "Cayman Islands",
  },
  {
    value: "CF",
    label: "Central African Republic",
  },
  {
    value: "TD",
    label: "Chad",
  },
  {
    value: "CL",
    label: "Chile",
  },
  {
    value: "CN",
    label: "China",
  },
  {
    value: "CX",
    label: "Christmas Island",
  },
  {
    value: "CC",
    label: "Cocos (Keeling) Islands",
  },
  {
    value: "CO",
    label: "Colombia",
  },
  {
    value: "KM",
    label: "Comoros",
  },
  {
    value: "CG",
    label: "Congo - Brazzaville",
  },
  {
    value: "CD",
    label: "Congo - Kinshasa",
  },
  {
    value: "CK",
    label: "Cook Islands",
  },
  {
    value: "CR",
    label: "Costa Rica",
  },
  {
    value: "CI",
    label: "Côte d’Ivoire",
  },
  {
    value: "HR",
    label: "Croatia",
  },
  {
    value: "CU",
    label: "Cuba",
  },
  {
    value: "CW",
    label: "Curaçao",
  },
  {
    value: "CY",
    label: "Cyprus",
  },
  {
    value: "CZ",
    label: "Czechia",
  },
  {
    value: "DK",
    label: "Denmark",
  },
  {
    value: "DJ",
    label: "Djibouti",
  },
  {
    value: "DM",
    label: "Dominica",
  },
  {
    value: "DO",
    label: "Dominican Republic",
  },
  {
    value: "EC",
    label: "Ecuador",
  },
  {
    value: "EG",
    label: "Egypt",
  },
  {
    value: "SV",
    label: "El Salvador",
  },
  {
    value: "GQ",
    label: "Equatorial Guinea",
  },
  {
    value: "ER",
    label: "Eritrea",
  },
  {
    value: "EE",
    label: "Estonia",
  },
  {
    value: "SZ",
    label: "Eswatini",
  },
  {
    value: "ET",
    label: "Ethiopia",
  },
  {
    value: "FK",
    label: "Falkland Islands",
  },
  {
    value: "FO",
    label: "Faroe Islands",
  },
  {
    value: "FJ",
    label: "Fiji",
  },
  {
    value: "FI",
    label: "Finland",
  },
  {
    value: "FR",
    label: "France",
  },
  {
    value: "GF",
    label: "French Guiana",
  },
  {
    value: "PF",
    label: "French Polynesia",
  },
  {
    value: "TF",
    label: "French Southern Territories",
  },
  {
    value: "GA",
    label: "Gabon",
  },
  {
    value: "GM",
    label: "Gambia",
  },
  {
    value: "GE",
    label: "Georgia",
  },
  {
    value: "DE",
    label: "Germany",
  },
  {
    value: "GH",
    label: "Ghana",
  },
  {
    value: "GI",
    label: "Gibraltar",
  },
  {
    value: "GR",
    label: "Greece",
  },
  {
    value: "GL",
    label: "Greenland",
  },
  {
    value: "GD",
    label: "Grenada",
  },
  {
    value: "GP",
    label: "Guadeloupe",
  },
  {
    value: "GU",
    label: "Guam",
  },
  {
    value: "GT",
    label: "Guatemala",
  },
  {
    value: "GG",
    label: "Guernsey",
  },
  {
    value: "GN",
    label: "Guinea",
  },
  {
    value: "GW",
    label: "Guinea-Bissau",
  },
  {
    value: "GY",
    label: "Guyana",
  },
  {
    value: "HT",
    label: "Haiti",
  },
  {
    value: "HM",
    label: "Heard & McDonald Islands",
  },
  {
    value: "HN",
    label: "Honduras",
  },
  {
    value: "HK",
    label: "Hong Kong SAR China",
  },
  {
    value: "HU",
    label: "Hungary",
  },
  {
    value: "IS",
    label: "Iceland",
  },
  {
    value: "IN",
    label: "India",
  },
  {
    value: "ID",
    label: "Indonesia",
  },
  {
    value: "IR",
    label: "Iran",
  },
  {
    value: "IQ",
    label: "Iraq",
  },
  {
    value: "IE",
    label: "Ireland",
  },
  {
    value: "IM",
    label: "Isle of Man",
  },
  {
    value: "IL",
    label: "Israel",
  },
  {
    value: "IT",
    label: "Italy",
  },
  {
    value: "JM",
    label: "Jamaica",
  },
  {
    value: "JP",
    label: "Japan",
  },
  {
    value: "JE",
    label: "Jersey",
  },
  {
    value: "JO",
    label: "Jordan",
  },
  {
    value: "KZ",
    label: "Kazakhstan",
  },
  {
    value: "KE",
    label: "Kenya",
  },
  {
    value: "KI",
    label: "Kiribati",
  },
  {
    value: "KW",
    label: "Kuwait",
  },
  {
    value: "KG",
    label: "Kyrgyzstan",
  },
  {
    value: "LA",
    label: "Laos",
  },
  {
    value: "LV",
    label: "Latvia",
  },
  {
    value: "LB",
    label: "Lebanon",
  },
  {
    value: "LS",
    label: "Lesotho",
  },
  {
    value: "LR",
    label: "Liberia",
  },
  {
    value: "LY",
    label: "Libya",
  },
  {
    value: "LI",
    label: "Liechtenstein",
  },
  {
    value: "LT",
    label: "Lithuania",
  },
  {
    value: "LU",
    label: "Luxembourg",
  },
  {
    value: "MO",
    label: "Macao SAR China",
  },
  {
    value: "MG",
    label: "Madagascar",
  },
  {
    value: "MW",
    label: "Malawi",
  },
  {
    value: "MY",
    label: "Malaysia",
  },
  {
    value: "MV",
    label: "Maldives",
  },
  {
    value: "ML",
    label: "Mali",
  },
  {
    value: "MT",
    label: "Malta",
  },
  {
    value: "MH",
    label: "Marshall Islands",
  },
  {
    value: "MQ",
    label: "Martinique",
  },
  {
    value: "MR",
    label: "Mauritania",
  },
  {
    value: "MU",
    label: "Mauritius",
  },
  {
    value: "YT",
    label: "Mayotte",
  },
  {
    value: "MX",
    label: "Mexico",
  },
  {
    value: "FM",
    label: "Micronesia",
  },
  {
    value: "MD",
    label: "Moldova",
  },
  {
    value: "MC",
    label: "Monaco",
  },
  {
    value: "MN",
    label: "Mongolia",
  },
  {
    value: "ME",
    label: "Montenegro",
  },
  {
    value: "MS",
    label: "Montserrat",
  },
  {
    value: "MA",
    label: "Morocco",
  },
  {
    value: "MZ",
    label: "Mozambique",
  },
  {
    value: "MM",
    label: "Myanmar (Burma)",
  },
  {
    value: "NA",
    label: "Namibia",
  },
  {
    value: "NR",
    label: "Nauru",
  },
  {
    value: "NP",
    label: "Nepal",
  },
  {
    value: "NL",
    label: "Netherlands",
  },
  {
    value: "NC",
    label: "New Caledonia",
  },
  {
    value: "NZ",
    label: "New Zealand",
  },
  {
    value: "NI",
    label: "Nicaragua",
  },
  {
    value: "NE",
    label: "Niger",
  },
  {
    value: "NG",
    label: "Nigeria",
  },
  {
    value: "NU",
    label: "Niue",
  },
  {
    value: "NF",
    label: "Norfolk Island",
  },
  {
    value: "KP",
    label: "North Korea",
  },
  {
    value: "MK",
    label: "North Macedonia",
  },
  {
    value: "MP",
    label: "Northern Mariana Islands",
  },
  {
    value: "NO",
    label: "Norway",
  },
  {
    value: "OM",
    label: "Oman",
  },
  {
    value: "PK",
    label: "Pakistan",
  },
  {
    value: "PW",
    label: "Palau",
  },
  {
    value: "PS",
    label: "Palestinian Territories",
  },
  {
    value: "PA",
    label: "Panama",
  },
  {
    value: "PG",
    label: "Papua New Guinea",
  },
  {
    value: "PY",
    label: "Paraguay",
  },
  {
    value: "PE",
    label: "Peru",
  },
  {
    value: "PH",
    label: "Philippines",
  },
  {
    value: "PN",
    label: "Pitcairn Islands",
  },
  {
    value: "PL",
    label: "Poland",
  },
  {
    value: "PT",
    label: "Portugal",
  },
  {
    value: "PR",
    label: "Puerto Rico",
  },
  {
    value: "QA",
    label: "Qatar",
  },
  {
    value: "RE",
    label: "Réunion",
  },
  {
    value: "RO",
    label: "Romania",
  },
  {
    value: "RU",
    label: "Russia",
  },
  {
    value: "RW",
    label: "Rwanda",
  },
  {
    value: "WS",
    label: "Samoa",
  },
  {
    value: "SM",
    label: "San Marino",
  },
  {
    value: "ST",
    label: "São Tomé & Príncipe",
  },
  {
    value: "SA",
    label: "Saudi Arabia",
  },
  {
    value: "SN",
    label: "Senegal",
  },
  {
    value: "RS",
    label: "Serbia",
  },
  {
    value: "SC",
    label: "Seychelles",
  },
  {
    value: "SL",
    label: "Sierra Leone",
  },
  {
    value: "SG",
    label: "Singapore",
  },
  {
    value: "SX",
    label: "Sint Maarten",
  },
  {
    value: "SK",
    label: "Slovakia",
  },
  {
    value: "SI",
    label: "Slovenia",
  },
  {
    value: "SB",
    label: "Solomon Islands",
  },
  {
    value: "SO",
    label: "Somalia",
  },
  {
    value: "ZA",
    label: "South Africa",
  },
  {
    value: "GS",
    label: "South Georgia & South Sandwich Islands",
  },
  {
    value: "KR",
    label: "South Korea",
  },
  {
    value: "SS",
    label: "South Sudan",
  },
  {
    value: "ES",
    label: "Spain",
  },
  {
    value: "LK",
    label: "Sri Lanka",
  },
  {
    value: "BL",
    label: "St. Barthélemy",
  },
  {
    value: "SH",
    label: "St. Helena",
  },
  {
    value: "KN",
    label: "St. Kitts & Nevis",
  },
  {
    value: "LC",
    label: "St. Lucia",
  },
  {
    value: "MF",
    label: "St. Martin",
  },
  {
    value: "PM",
    label: "St. Pierre & Miquelon",
  },
  {
    value: "VC",
    label: "St. Vincent & Grenadines",
  },
  {
    value: "SD",
    label: "Sudan",
  },
  {
    value: "SR",
    label: "Suriname",
  },
  {
    value: "SJ",
    label: "Svalbard & Jan Mayen",
  },
  {
    value: "SE",
    label: "Sweden",
  },
  {
    value: "CH",
    label: "Switzerland",
  },
  {
    value: "SY",
    label: "Syria",
  },
  {
    value: "TW",
    label: "Taiwan",
  },
  {
    value: "TJ",
    label: "Tajikistan",
  },
  {
    value: "TZ",
    label: "Tanzania",
  },
  {
    value: "TH",
    label: "Thailand",
  },
  {
    value: "TL",
    label: "Timor-Leste",
  },
  {
    value: "TG",
    label: "Togo",
  },
  {
    value: "TK",
    label: "Tokelau",
  },
  {
    value: "TO",
    label: "Tonga",
  },
  {
    value: "TT",
    label: "Trinidad & Tobago",
  },
  {
    value: "TN",
    label: "Tunisia",
  },
  {
    value: "TR",
    label: "Türkiye",
  },
  {
    value: "TM",
    label: "Turkmenistan",
  },
  {
    value: "TC",
    label: "Turks & Caicos Islands",
  },
  {
    value: "TV",
    label: "Tuvalu",
  },
  {
    value: "UM",
    label: "U.S. Outlying Islands",
  },
  {
    value: "VI",
    label: "U.S. Virgin Islands",
  },
  {
    value: "UG",
    label: "Uganda",
  },
  {
    value: "UA",
    label: "Ukraine",
  },
  {
    value: "AE",
    label: "United Arab Emirates",
  },
  {
    value: "GB",
    label: "United Kingdom",
  },
  {
    value: "US",
    label: "United States",
  },
  {
    value: "UY",
    label: "Uruguay",
  },
  {
    value: "UZ",
    label: "Uzbekistan",
  },
  {
    value: "VU",
    label: "Vanuatu",
  },
  {
    value: "VA",
    label: "Vatican City",
  },
  {
    value: "VE",
    label: "Venezuela",
  },
  {
    value: "VN",
    label: "Vietnam",
  },
  {
    value: "WF",
    label: "Wallis & Futuna",
  },
  {
    value: "EH",
    label: "Western Sahara",
  },
  {
    value: "YE",
    label: "Yemen",
  },
  {
    value: "ZM",
    label: "Zambia",
  },
  {
    value: "ZW",
    label: "Zimbabwe",
  },
];

const SIGNIN = "signin";
const SIGNUP = "signup";

const AUTH_DRAFT_KEY = "hs_auth_draft";

function loadAuthDraft() {
  try {
    const raw = sessionStorage.getItem(AUTH_DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveAuthDraft(mode, form) {
  try {
    sessionStorage.setItem(AUTH_DRAFT_KEY, JSON.stringify({ mode, form }));
  } catch {
    // ignore
  }
}

function clearAuthDraft() {
  try {
    sessionStorage.removeItem(AUTH_DRAFT_KEY);
  } catch {
    // ignore
  }
}

export default function Auth() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const { user, authReady, login, register, signInWithGoogle, requestCode } =
    useAuth();

  const [mode, setMode] = useState(() => {
    const urlMode = params.get("mode");
    if (urlMode === "signup") return SIGNUP;
    if (urlMode === "signin") return SIGNIN;
    const draft = loadAuthDraft();
    if (draft?.mode === SIGNUP) return SIGNUP;
    return SIGNIN;
  });

  // `email` is carried over from Landing's CTA, which collects it before
  // sending the visitor here — without this the field arrives empty and they
  // type it twice. Draft rehydration preserves credentials when reading terms/policy.
  const [form, setForm] = useState(() => {
    const draft = loadAuthDraft();
    const draftForm = draft?.form || {};
    return {
      username: draftForm.username ?? "",
      email: params.get("email") ?? draftForm.email ?? "",
      password: draftForm.password ?? "",
      country: draftForm.country ?? "",
    };
  });
  const [error, setError] = useState(() => {
    const err = params.get("error");
    const desc = params.get("error_description");
    if (!err && !desc) return null;
    if (desc) return desc;
    if (err === "access_denied") {
      return "Google sign-in was canceled.";
    }
    if (
      err === "oauth" ||
      err === "state_mismatch" ||
      err === "state_not_found" ||
      err === "invalid_code"
    ) {
      return "Google authentication failed or expired. Please try again or sign in with your password.";
    }
    if (err === "account_not_linked") {
      return "An account with this email already exists. Please sign in with your email and password to link your Google account.";
    }
    if (err === "unable_to_create_user") {
      return "Account creation could not be completed. Please try again or sign up with email.";
    }
    if (err === "unable_to_link_account") {
      return "Could not link this Google account. Please try signing in with your email and password.";
    }
    return "Sign-in could not be completed. Please try again.";
  });
  const [infoNotice, setInfoNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [animating, setAnimating] = useState(false);
  /** Which confirmation to raise once the session lands, or null. */
  const [welcomeKind, setWelcomeKind] = useState(
    /** @type {string | null} */ (null)
  );
  const [legalModalDoc, setLegalModalDoc] = useState(
    /** @type {null | 'terms' | 'privacy'} */ (null)
  );

  const isSignup = mode === SIGNUP;

  useEffect(() => {
    saveAuthDraft(mode, form);
  }, [mode, form]);

  const handleSuggestPassword = async () => {
    const pwd = generateStrongPassword();
    setForm((f) => ({ ...f, password: pwd }));
    try {
      await navigator.clipboard.writeText(pwd);
      notify.success(
        t(
          "auth.passwordCopied",
          "Strong password generated and copied to clipboard!"
        )
      );
    } catch {
      notify.success(t("auth.passwordGenerated", "Strong password generated!"));
    }
  };
  /**
   * WHERE SIGNING IN LANDS YOU. The default is the landing page, not the
   * portfolio.
   *
   * `?next=` STILL WINS, and that is the half that matters. `ProtectedRoute`
   * sends somebody here with the page they were trying to reach attached, so a
   * user who clicked through to `/withdraw` and got bounced to sign in still
   * arrives at `/withdraw` afterwards — changing the fallback must not break
   * the case where the destination was actually known.
   */
  const explicitNext = params.get("next");
  const next = explicitNext || "/";

  const field = (name) => ({
    name,
    value: form[name],
    onChange: (e) => {
      const val = e.target.value;
      setForm((f) => {
        const nextForm = { ...f, [name]: val };
        if (!isSignup && name === "username" && !nextForm.email) {
          nextForm.email = val;
        }
        return nextForm;
      });
      if (error) setError(null);
    },
  });

  /**
   * Whether the button can actually work. Rendering "Continue with Google" on a
   * deployment with no Google credentials configured produces a press that ends
   * on a Google error page — so the server is asked, and the button simply does
   * not exist when it would fail. `staleTime: Infinity` because this changes
   * when the server restarts, not while somebody is looking at a login form.
   */
  /** null, 'sign-in', 'reset', or 'verify-email' — which code flow has replaced the form. */
  const [codeFlow, setCodeFlow] = useState(
    /** @type {null|'sign-in'|'reset'|'verify-email'} */ (null)
  );

  const { data: providers } = useQuery({
    queryKey: ["auth", "providers"],
    queryFn: () => get("/auth-providers"),
    staleTime: Infinity,
  });

  /**
   * ALREADY SIGNED IN? DON'T SHOW THE FORM AT ALL — and this redirect is also
   * what carries a fresh sign-in to its destination.
   *
   * It has to be, because it WINS THE RACE. `login()` resolving sets `user` in
   * the provider, which re-renders this component and fires this `<Navigate>`
   * before the `navigate()` after the await ever runs — so a marker appended
   * there was silently dropped and the toast never fired. `welcomeKind` is set
   * BEFORE the await, so by the time `user` lands it is already here.
   *
   * Null when somebody merely arrives on /auth with a live session: that is not
   * a sign-in and must not announce one.
   */
  if (authReady && user) {
    clearAuthDraft();
    /**
     * AN OPERATOR LANDS IN THE ADMIN SECTION, everybody else on the landing
     * page. The role is only knowable HERE — `next` is computed before anyone
     * has signed in, while this branch runs with `user` already resolved.
     *
     * `?next=` still outranks both. `ProtectedRoute` attaches the page somebody
     * was bounced from, and an admin who clicked `/withdraw` meant `/withdraw`;
     * a convenience default must never override a destination that was actually
     * known.
     *
     * THE GOOGLE LEG CANNOT DO THIS and deliberately does not try. Its
     * `callbackURL` is fixed before the round trip, when there is no session to
     * read a role from — so an admin signing in with Google lands on `/` and
     * reaches the section from the nav, which renders for them either way.
     */
    const destination =
      explicitNext || (user.role === "admin" ? ADMIN_HOME : "/");
    return (
      <Navigate
        to={welcomeKind ? withWelcome(destination, welcomeKind) : destination}
        replace
      />
    );
  }

  const onGoogle = async () => {
    setError(null);
    setInfoNotice(null);
    setBusy(true);
    try {
      // Does not return — it navigates to Google. `busy` stays true so the
      // button cannot be pressed twice while the redirect is in flight.
      await signInWithGoogle(withWelcome(next, WELCOME.signIn));
    } catch (err) {
      setError(err.message ?? "Could not start Google sign-in.");
      setBusy(false);
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setInfoNotice(null);
    setBusy(true);
    try {
      if (isSignup) {
        // Fast proactive check via /auth-lookup to redirect existing accounts
        try {
          const check = await get(
            `/auth-lookup?email=${encodeURIComponent(form.email)}&username=${encodeURIComponent(form.username)}`
          );
          if (check?.exists) {
            setMode(SIGNIN);
            setForm((f) => ({
              ...f,
              email: check.identifier || f.email || f.username,
              password: "",
            }));
            setInfoNotice(
              check.matchedField === "email"
                ? "An account with this email already exists. Please enter your password to sign in."
                : "An account with this username already exists. Please enter your password to sign in."
            );
            setBusy(false);
            return;
          }
        } catch {
          // Fall through to standard register
        }

        if (!isStrongPassword(form.password)) {
          setError(t("errors.PASSWORD_TOO_WEAK"));
          setBusy(false);
          return;
        }

        const res = await register({
          username: form.username,
          email: form.email,
          password: form.password,
          country: form.country,
        });

        if (!res?.token) {
          setWelcomeKind(null);
          setCodeFlow("verify-email");
          return;
        }

        clearAuthDraft();
        setWelcomeKind(WELCOME.signUp);
      } else {
        clearAuthDraft();
        setWelcomeKind(WELCOME.signIn);
        const identifier = (form.email || form.username || "").trim();
        await login({ email: identifier, password: form.password });
      }
    } catch (err) {
      setWelcomeKind(null);
      const errMsg = err.message || "";
      const errCode = err.code || "";

      const isUnverified =
        errCode === "EMAIL_NOT_VERIFIED" ||
        /email.*not.*verified/i.test(errMsg);

      if (isUnverified) {
        try {
          await requestCode({
            email: form.email || form.username,
            purpose: "verify-email",
          });
        } catch {
          // ignore resend error
        }
        setCodeFlow("verify-email");
        return;
      }

      if (isSignup) {
        const isEmailTaken =
          errCode === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" ||
          errCode === "USER_ALREADY_EXISTS" ||
          /already exists/i.test(errMsg);
        const isUsernameTaken =
          errCode === "USERNAME_IS_ALREADY_TAKEN" ||
          /username is already taken/i.test(errMsg);

        if (isEmailTaken || isUsernameTaken) {
          setMode(SIGNIN);
          setForm((f) => ({
            ...f,
            email: isEmailTaken ? f.email : f.username || f.email,
            password: "",
          }));
          setInfoNotice(
            isEmailTaken
              ? "An account with this email already exists. Please enter your password to sign in."
              : "An account with this username already exists. Please enter your password to sign in."
          );
          return;
        }

        setError(err.message ?? "Something went wrong. Try again.");
      } else {
        setError(errorMessage(err, t("errors.INVALID_EMAIL_OR_PASSWORD")));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-140px)] items-center justify-center bg-mist px-4 py-10 sm:py-16">
      <div className="w-full max-w-105">
        {/* The mark sits ABOVE the card rather than inside it. Inside, it
            competed with the heading for the top of the card and pushed the
            form down; outside, it identifies the page and lets the card open
            on the thing the visitor came to do. */}
        <div className="mb-7 flex justify-center">
          <Logo size={44} withWordmark={false} to={null} />
        </div>

        {/*
          `rounded-xl` and `shadow-panel`, not the `rounded-md`/`shadow-card`
          this used to carry. Those are the table-and-tile pair used across the
          dashboard, where a card is one of twenty on screen; this is a single
          object on an empty field and the softer, larger pairing is what stops
          it reading as a widget that lost its page. The padding went from 24 to
          32/40 for the same reason.
        */}
        <div className="animate-rise rounded-xl border border-cool-grey bg-white p-8 shadow-panel sm:p-10">
          {codeFlow ? (
            <CodeForm
              purpose={codeFlow}
              /* The address already typed is carried across. Asking for it a
                 second time on the next screen is the kind of small friction
                 that makes a recovery flow feel like a punishment. */
              initialEmail={form.email}
              onCancel={() => setCodeFlow(null)}
              onSuccess={() => {
                setWelcomeKind(
                  codeFlow === "verify-email" ? WELCOME.signUp : WELCOME.signIn
                );
                setCodeFlow(null);
              }}
              onUserNotFound={(email) => {
                setCodeFlow(null);
                setMode(SIGNUP);
                setForm((prev) => ({ ...prev, email }));
                setInfoNotice(t("auth.notFoundNotice"));
              }}
            />
          ) : (
            <>
              <SegmentedControl
                options={[
                  { value: SIGNIN, label: t("auth.signIn") },
                  { value: SIGNUP, label: t("auth.signUp") },
                ]}
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  setError(null);
                  setInfoNotice(null);
                  setAnimating(true);
                }}
                size="sm"
                className="mb-7 w-full [&>button]:flex-1"
              />

              {/* KEYED ON THE MODE so the fade actually replays. React would
              otherwise reuse these nodes and just swap their text, and a CSS
              animation on an element that never remounts runs exactly once —
              the first switch would animate and every one after it would snap. */}
              <div key={mode} className="animate-swap">
                <h1 className="m-0 text-2xl font-medium">
                  {isSignup ? t("auth.createAccount") : t("auth.welcomeBack")}
                </h1>
                <p className="mt-2 mb-7 text-sm text-text-muted">
                  {isSignup ? t("auth.signupLead") : t("auth.signinLead")}
                </p>
              </div>

              {providers?.google && (
                <>
                  <button
                    type="button"
                    onClick={onGoogle}
                    disabled={busy}
                    className="flex w-full cursor-pointer items-center justify-center gap-2.5 rounded-lg border border-cool-grey bg-white py-2.5 font-display text-sm font-medium transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-45"
                  >
                    {/* The real mark from react-icons, already in the bundle — the
                    same rule CoinIcon follows: never approximate a trademark by
                    hand, and never hotlink one either. */}
                    <FcGoogle size={18} aria-hidden="true" />
                    {t("auth.continueWithGoogle")}
                  </button>

                  {/* A rule with the word in it, not a bare line: two stacked
                  buttons with nothing between them read as one control group
                  rather than as two independent ways in. */}
                  <div className="my-5 flex items-center gap-3">
                    <span className="h-px flex-1 bg-cool-grey" />
                    <span className="text-2xs text-text-muted uppercase">
                      {t("auth.or")}
                    </span>
                    <span className="h-px flex-1 bg-cool-grey" />
                  </div>
                </>
              )}

              <form onSubmit={onSubmit} className="flex flex-col gap-4">
                {/*
              `grid-template-rows: 0fr -> 1fr`, the same technique the FAQ
              accordion uses, because `height: auto` is not animatable and the
              usual `max-height` workaround makes the field open at the speed of
              whatever arbitrary maximum was guessed.
              `invisible` rather than unmounting: the input must leave the tab
              order and the form's required-field set while collapsed, and
              `visibility` does both without costing the animation its element.
            */}
                <div
                  data-auth-collapse
                  className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                    isSignup ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                  onTransitionEnd={() => setAnimating(false)}
                >
                  <div
                    className={`${
                      isSignup && !animating
                        ? "overflow-visible"
                        : "overflow-hidden"
                    } ${isSignup ? "" : "invisible"}`}
                  >
                    <Input
                      label={t("auth.username")}
                      placeholder={t("auth.usernamePlaceholder")}
                      autoComplete={isSignup ? "username" : "off"}
                      icon={<FiUser size={16} />}
                      required={isSignup}
                      disabled={!isSignup}
                      {...field("username")}
                    />

                    <div className="mt-4 flex flex-col gap-1.5">
                      <label className="font-display text-xs font-semibold uppercase text-text-body">
                        Country
                      </label>
                      <Select
                        value={form.country}
                        onChange={(value) =>
                          setForm((f) => ({ ...f, country: value }))
                        }
                        options={COUNTRIES}
                        placeholder="Select Country"
                        disabled={!isSignup}
                      />
                    </div>
                  </div>
                </div>

                <Input
                  label={isSignup ? t("auth.email") : "Email or Username"}
                  type={isSignup ? "email" : "text"}
                  placeholder={
                    isSignup
                      ? t("auth.emailPlaceholder")
                      : "name@example.com or username"
                  }
                  autoComplete={isSignup ? "email" : "username"}
                  icon={<FiMail size={16} />}
                  required
                  {...field("email")}
                />

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-text-body">
                      {t("auth.password")}
                    </label>
                    {isSignup && (
                      <button
                        type="button"
                        onClick={handleSuggestPassword}
                        className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-gain hover:underline"
                      >
                        <FiKey size={13} aria-hidden="true" />
                        {t(
                          "auth.suggestStrongPassword",
                          "Suggest strong password"
                        )}
                      </button>
                    )}
                  </div>
                  <Input
                    type="password"
                    placeholder="••••••••"
                    autoComplete={
                      isSignup ? "new-password" : "current-password"
                    }
                    icon={<FiLock size={16} />}
                    revealable
                    required
                    {...field("password")}
                  />
                  {isSignup && (
                    <PasswordStrengthMeter password={form.password} />
                  )}
                </div>

                {infoNotice && (
                  <div className="flex items-start gap-2.5 rounded-md border border-gain/40 bg-gain-tint px-3 py-2.5 text-xs text-gain">
                    <FiInfo
                      size={16}
                      className="mt-0.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span>{infoNotice}</span>
                  </div>
                )}

                {error && (
                  <div className="rounded-md border border-cool-grey bg-red-tint px-3 py-2 text-xs text-loss">
                    {error}
                  </div>
                )}

                <Button type="submit" className="w-full" loading={busy}>
                  {isSignup ? t("auth.signUp") : t("auth.signIn")}
                </Button>
              </form>

              {isSignup ? null : (
                /* BOTH OF THESE USED TO BE DEAD. "Forgot password" was a styled
               <span> that did nothing, because there was no mailer behind it;
               it opens the reset flow now. The code option sits beside it
               because the same machinery serves both. */
                <div className="mt-4 flex justify-center gap-5 text-xs">
                  <button
                    type="button"
                    onClick={() => setCodeFlow("sign-in")}
                    className="cursor-pointer text-text-muted underline underline-offset-2 hover:text-gain"
                  >
                    {t("auth.code.useCode")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCodeFlow("reset")}
                    className="cursor-pointer text-text-muted underline underline-offset-2 hover:text-gain"
                  >
                    {t("auth.forgot")}
                  </button>
                </div>
              )}
            </>
          )}

          {/*
            `<Trans>` RATHER THAN THREE KEYS SPLICED TOGETHER, and this sentence
            is the case that justifies it. It carries TWO links, so a
            pre/mid/post split would need three fragments whose order is fixed
            by the JSX — and that order is not fixed across languages. German is
            the proof: "Mit dem Fortfahren stimmen Sie unseren <terms>…</terms>
            und unserer <privacy>…</privacy> ZU", where the verb's particle
            lands after both links. No concatenation can express that.

            The components are NAMED, not indexed. `<0>`/`<1>` keys break
            silently the moment anybody reorders the JSX, and the failure there
            is a link pointing at the wrong document — on a consent line.

            Shown on BOTH modes by request. On sign-in "by continuing" is the
            weaker claim, but the terms govern using the account either way.
          */}
          <p className="mt-6 text-center text-xs leading-relaxed text-text-muted">
            <Trans
              i18nKey="auth.termsNotice"
              components={{
                terms: (
                  <button
                    type="button"
                    onClick={() => setLegalModalDoc("terms")}
                    className="cursor-pointer text-text-body underline underline-offset-2 hover:text-gain"
                  />
                ),
                privacy: (
                  <button
                    type="button"
                    onClick={() => setLegalModalDoc("privacy")}
                    className="cursor-pointer text-text-body underline underline-offset-2 hover:text-gain"
                  />
                ),
              }}
            />
          </p>
        </div>
      </div>

      <LegalModal
        open={Boolean(legalModalDoc)}
        initialDoc={legalModalDoc ?? "terms"}
        onClose={() => setLegalModalDoc(null)}
      />
    </div>
  );
}
