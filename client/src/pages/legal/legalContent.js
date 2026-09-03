import { SUPPORT_EMAIL } from '../../lib/contact';
/**
 * The legal documents, as data.
 *
 * ENGLISH ONLY, AND DELIBERATELY OUTSIDE THE i18n BUNDLES. Every other string in
 * this app is translated and both bundles are asserted key-identical — these are
 * not, and the reason is not laziness. A translated privacy policy is a SECOND
 * LEGAL DOCUMENT in different words, and a data-rights clause that drifts in
 * translation is an exposure rather than a rough edge. Real multilingual
 * products ship one governing language and translate on request; the page says
 * so, in the reader's own language, because that sentence IS chrome.
 *
 * Keeping them out of `en.json`/`uk.json` also keeps the parity check honest:
 * these keys would otherwise be permanently "en-only" and the check would have
 * to grow an exception, which is how a check stops catching anything.
 *
 * CARRIED AS SUPPLIED, with one change, the same one the About page took:
 * "Hyperstock" is written "HyperStocks" to match the wordmark above it. The
 * contact addresses are exactly as given — see the note in the repo README on
 * the domain they use against the one the rest of the product uses.
 *
 * A block is a string (paragraph), `{ list: [...] }`, or `{ subheading, list? }`
 * — three shapes because the source has three, and a markdown renderer for that
 * is more machinery than the content needs.
 */

export const LAST_UPDATED = '2026-08-25';

export const PRIVACY = {
  id: 'privacy',
  title: 'Privacy Policy',
  intro: [
    'At HyperStocks, we believe your financial information deserves the highest level of care, discretion, and protection.',
    'This Privacy Policy explains how HyperStocks collects, uses, protects, stores, and shares information when you visit our website, create an account, use our platform, or interact with our services.',
    'As a financial and trading platform serving individual and high-net-worth clients, we collect information necessary to establish and manage your account, provide trading services, protect your account, and meet applicable legal and regulatory requirements.',
  ],
  sections: [
    {
      heading: 'Information We Collect',
      blocks: [
        'We aim to collect only information reasonably necessary for the services we provide and the relationship we maintain with you.',
        { subheading: 'Personal Information' },
        'Depending on your account and the services you use, this may include:',
        {
          list: [
            'Full name',
            'Date of birth',
            'Contact information',
            'Residential address',
            'Government-issued identification',
            'Tax identification information where required',
            'Citizenship or residency information',
          ],
        },
        'For high-net-worth clients and sophisticated investors, including clients with substantial portfolios of $5 million or more, additional information may be requested when reasonably necessary to establish and manage the account or satisfy applicable compliance requirements.',
        { subheading: 'Financial Information' },
        'When you fund or trade through HyperStocks, we may collect information such as:',
        {
          list: [
            'Funding and withdrawal information',
            'Account balances',
            'Trading activity',
            'Investment positions',
            'Transaction history',
            'Relevant financial information required to maintain your account',
          ],
        },
        'Additional financial information may be requested for certain high-value accounts where necessary for account administration, verification, or regulatory requirements.',
        { subheading: 'Technical Information' },
        'When you use HyperStocks, we may automatically collect limited technical and security information, including:',
        {
          list: [
            'IP address',
            'Device and browser information',
            'Login activity',
            'Security events',
            'Platform usage information',
          ],
        },
        'This information helps us maintain platform performance, security, and reliability.',
      ],
    },
    {
      heading: 'How We Use Your Information',
      blocks: [
        'We use information collected through HyperStocks to:',
        {
          list: [
            'Establish and maintain your account',
            'Verify your identity',
            'Provide trading and account services',
            'Process deposits and withdrawals',
            'Maintain transaction records',
            'Protect accounts against unauthorized activity',
            'Detect and prevent fraud',
            'Meet applicable legal and regulatory requirements',
            'Communicate with you',
            'Maintain and improve our platform',
          ],
        },
        'We do not use customer information for purposes that are incompatible with this Privacy Policy or applicable law.',
      ],
    },
    {
      heading: 'How We Share Information',
      blocks: [
        'We may share information when necessary to provide our services, protect our platform, or comply with legal and regulatory requirements.',
        'This may include sharing information with:',
        {
          list: [
            'Financial and banking service providers',
            'Clearing or custody providers',
            'Identity verification providers',
            'Technology and infrastructure providers',
            'Professional advisers',
            'Regulators and government authorities where legally required',
          ],
        },
        'Service providers that process information on our behalf are expected to handle that information appropriately and in accordance with applicable requirements.',
        'We do not sell your personal information.',
      ],
    },
    {
      heading: 'Financial Privacy',
      blocks: [
        'Information relating to your financial relationship with HyperStocks may be treated as nonpublic personal information where applicable.',
        'This may include information about your account, transactions, and financial relationship with us.',
        'We maintain safeguards designed to protect this information and limit access to individuals and service providers who require it for legitimate business, operational, security, or regulatory purposes.',
        'Where required, additional financial privacy notices may be provided.',
      ],
    },
    {
      heading: 'Data Security',
      blocks: [
        'HyperStocks uses administrative, technical, and organizational safeguards designed to protect customer information against unauthorized access, misuse, loss, or disclosure.',
        'Our security practices may include:',
        {
          list: [
            'Encryption',
            'Access controls',
            'Authentication',
            'Security monitoring',
            'Network protections',
            'Fraud detection',
            'Restricted employee access',
          ],
        },
        'No electronic system or internet transmission can be guaranteed to be completely secure. We continuously work to strengthen the security of our platform and customer information.',
      ],
    },
    {
      heading: 'Identity Verification and Compliance',
      blocks: [
        'To protect our platform and comply with applicable requirements, HyperStocks may use customer information for identity verification, fraud prevention, sanctions screening, and other required compliance procedures.',
        'Clients with substantial financial relationships may be asked to provide additional information when required to verify an account or satisfy applicable regulatory obligations.',
      ],
    },
    {
      heading: 'Data Retention',
      blocks: [
        'We retain information for as long as reasonably necessary to provide our services, maintain your account, protect against fraud, comply with applicable legal and regulatory requirements, and maintain required financial records.',
        'Certain information may need to be retained after an account has been closed.',
      ],
    },
    {
      heading: 'Your Privacy Rights',
      blocks: [
        'Depending on where you live and the laws applicable to you, you may have rights regarding your personal information, including rights to:',
        {
          list: [
            'Request access to certain information',
            'Request correction of inaccurate information',
            'Request deletion where legally permitted',
            'Request information about how your information is used',
            'Exercise applicable state privacy rights',
          ],
        },
        'Some rights may be limited by financial services, legal, regulatory, fraud prevention, or recordkeeping requirements.',
      ],
    },
    {
      heading: 'Changes to This Privacy Policy',
      blocks: [
        'We may update this Privacy Policy from time to time to reflect changes to our services, technology, legal obligations, or privacy practices.',
        'When material changes are made, we may provide additional notice where required.',
        'The Last Updated date indicates when this policy was most recently revised.',
      ],
    },
    {
      heading: 'Contact Us',
      blocks: [
        'If you have questions about this Privacy Policy or how HyperStocks handles your information, contact:',
        { contact: { name: 'HyperStocks Privacy Team', email: SUPPORT_EMAIL } },
      ],
    },
  ],
};

export const TERMS = {
  id: 'terms',
  title: 'Terms of Service',
  intro: [
    'Welcome to HyperStocks.',
    'These Terms of Service govern your access to and use of the HyperStocks website, applications, accounts, trading platform, and related services.',
    'By creating an account or using HyperStocks, you acknowledge that you have read and agree to these Terms.',
  ],
  sections: [
    {
      heading: 'Eligibility',
      blocks: [
        "You must meet HyperStocks' eligibility requirements to create and maintain an account.",
        'You may be required to:',
        {
          list: [
            'Meet applicable age requirements',
            'Provide accurate and current information',
            'Complete identity verification',
            'Provide requested documentation',
            'Satisfy applicable regulatory requirements',
          ],
        },
        'HyperStocks may refuse, restrict, suspend, or terminate an account where permitted by law.',
      ],
    },
    {
      heading: 'Your Account',
      blocks: [
        'You are responsible for maintaining accurate account information and protecting your account credentials.',
        'You must notify HyperStocks promptly if you believe your account has been accessed without authorization or if you identify activity that you do not recognize.',
        'You are responsible for maintaining the confidentiality of your login credentials and authentication information.',
      ],
    },
    {
      heading: 'Trading Services',
      blocks: [
        'HyperStocks provides access to trading services and supported markets through its platform.',
        'Depending on your account, eligibility, and available services, you may be able to trade:',
        {
          list: [
            'Stocks',
            'Mutual funds',
            'Gold',
            'Digital assets',
            'Other supported products',
          ],
        },
        'The availability of particular products, markets, features, and services may vary by account and jurisdiction.',
      ],
    },
    {
      heading: 'Orders and Account Activity',
      blocks: [
        'Orders and other instructions submitted through your account may be subject to applicable trading rules, verification procedures, market conditions, and platform requirements.',
        'You are responsible for reviewing your orders and account activity and ensuring that information submitted through your account is accurate.',
        'HyperStocks may cancel, reject, restrict, or review transactions where permitted or required by applicable law, regulation, or internal policies.',
      ],
    },
    {
      heading: 'Account Funding and Withdrawals',
      blocks: [
        'You may fund your account using funding methods made available through HyperStocks.',
        'Deposits and withdrawals may be subject to verification, processing requirements, account limits, and applicable compliance procedures.',
        'HyperStocks may delay or restrict a transaction where reasonably necessary to verify account activity, protect the account, or satisfy legal or regulatory requirements.',
      ],
    },
    {
      heading: 'Fees',
      blocks: [
        'Certain services, transactions, products, or funding methods may be subject to fees.',
        'Applicable fees will be presented through the platform, applicable agreements, or other appropriate disclosures.',
        'You are responsible for reviewing applicable fees before completing a transaction.',
      ],
    },
    {
      heading: 'Acceptable Use',
      blocks: [
        'You may not use HyperStocks to:',
        {
          list: [
            'Commit fraud',
            'Launder money',
            'Evade applicable sanctions',
            'Conduct unlawful transactions',
            'Misrepresent your identity',
            'Circumvent account restrictions',
            'Attempt unauthorized access',
            'Interfere with platform functionality or security',
            'Use the platform for unlawful purposes',
          ],
        },
        'HyperStocks may take appropriate action when prohibited activity is identified.',
      ],
    },
    {
      heading: 'Suspension and Termination',
      blocks: [
        'HyperStocks may suspend, restrict, or terminate your access where permitted by law, including when:',
        {
          list: [
            'You violate these Terms',
            'Information provided is inaccurate',
            'Required verification cannot be completed',
            'Suspicious or unauthorized activity is identified',
            'Continued access presents a security or compliance concern',
            'We are required to do so by law or regulation',
          ],
        },
        'Where applicable, account termination does not eliminate obligations that arose before termination.',
      ],
    },
    {
      heading: 'Electronic Communications and Intellectual Property',
      blocks: [
        'You agree that HyperStocks may communicate with you electronically regarding your account, transactions, notices, disclosures, security matters, and other services.',
        'You are responsible for maintaining a valid email address and reviewing communications sent to you.',
        'All HyperStocks trademarks, logos, software, designs, content, and platform technology are owned by or licensed to HyperStocks. You may not copy, modify, distribute, or use HyperStocks intellectual property without authorization.',
      ],
    },
    {
      heading: 'Contact HyperStocks',
      blocks: [
        'Questions regarding these Terms of Service can be directed to:',
        { contact: { name: 'HyperStocks Legal Department', email: SUPPORT_EMAIL } },
      ],
    },
  ],
};

export const FINANCIAL_PRIVACY = {
  id: 'financial-privacy',
  title: 'Financial Privacy Notice',
  intro: [
    'At HyperStocks, protecting the privacy and confidentiality of your financial information is an important part of the relationship we maintain with our customers.',
    'This Financial Privacy Notice explains how HyperStocks collects, uses, maintains, and discloses certain financial information in connection with your relationship with our platform.',
    'This notice supplements our general Privacy Policy and applies where applicable to customers and prospective customers.',
  ],
  sections: [
    {
      heading: 'Financial Information We Collect',
      blocks: [
        'We collect financial information that is reasonably necessary to establish, maintain, and service your account.',
        'This may include:',
        {
          list: [
            'Account information',
            'Funding and withdrawal activity',
            'Trading activity',
            'Account balances',
            'Investment positions',
            'Transaction history',
            'Payment information',
            'Relevant financial information required for account verification',
          ],
        },
        'For high-net-worth clients and sophisticated investors, including clients with substantial portfolios of $5 million or more, additional financial information may be requested when reasonably necessary to establish and manage the financial relationship or satisfy applicable legal and regulatory requirements.',
        'We aim to collect information that is relevant to the services we provide and the relationship we maintain with you.',
      ],
    },
    {
      heading: 'How We Use Financial Information',
      blocks: [
        'HyperStocks may use financial information to:',
        {
          list: [
            'Establish and maintain your account',
            'Provide trading and financial services',
            'Process deposits and withdrawals',
            'Maintain accurate account records',
            'Process and maintain transaction records',
            'Protect accounts against unauthorized activity',
            'Detect and prevent fraud',
            'Conduct required compliance reviews',
            'Meet applicable legal and regulatory obligations',
            'Communicate with you regarding your account',
            'Resolve account-related issues',
            'Protect the integrity of our platform',
          ],
        },
        'We use financial information only for legitimate business, operational, security, service, and regulatory purposes.',
      ],
    },
    {
      heading: 'When We Share Financial Information',
      blocks: [
        'HyperStocks may disclose financial information when reasonably necessary to provide our services, protect our customers, operate our platform, or comply with applicable law.',
        'Depending on the circumstances, information may be shared with:',
        {
          list: [
            'Banking and financial service providers',
            'Clearing or custody providers',
            'Payment providers',
            'Identity verification providers',
            'Technology and infrastructure providers',
            'Professional advisers',
            'Auditors',
            'Regulators and government authorities where legally required',
          ],
        },
        'We do not sell customer financial information.',
        'Where third-party service providers process information on our behalf, we take reasonable steps to ensure that the information is handled appropriately and protected in accordance with applicable requirements.',
      ],
    },
    {
      heading: 'Your Financial Privacy',
      blocks: [
        'We recognize that financial information is highly sensitive.',
        'Access to customer financial information is limited to individuals and service providers who require it for legitimate business, operational, security, or regulatory purposes.',
        'We maintain safeguards designed to protect the confidentiality and integrity of financial information throughout the account relationship.',
      ],
    },
    {
      heading: 'Protecting Your Information',
      blocks: [
        'HyperStocks maintains administrative, technical, and organizational safeguards designed to protect financial information against unauthorized access, misuse, loss, or disclosure.',
        'These safeguards may include:',
        {
          list: [
            'Encryption',
            'Authentication controls',
            'Access restrictions',
            'Security monitoring',
            'Fraud detection',
            'Network protections',
            'Employee access controls',
          ],
        },
        'We continuously review and improve our security practices as our platform and services evolve.',
        'No electronic system can completely eliminate security risk.',
      ],
    },
    {
      heading: 'Information Retention',
      blocks: [
        'We retain financial information for as long as reasonably necessary to maintain your account, provide our services, protect against fraud, resolve disputes, and satisfy applicable legal, regulatory, accounting, and recordkeeping requirements.',
        'Certain financial records may need to be retained after an account has been closed.',
      ],
    },
    {
      heading: 'Former Customers',
      blocks: [
        'We continue to protect certain financial information relating to former customers in accordance with applicable law and our information-security practices.',
        'Information may be retained after an account is closed where necessary to satisfy legal or regulatory requirements or for legitimate business and security purposes.',
      ],
    },
    {
      heading: 'Questions About Financial Privacy',
      blocks: [
        'If you have questions about this notice or how HyperStocks handles your financial information, contact:',
        { contact: { name: 'HyperStocks Privacy Team', email: SUPPORT_EMAIL } },
      ],
    },
  ],
};

export const RISK = {
  id: 'risk-disclosure',
  title: 'Risk Disclosure Statement',
  intro: [
    'Investing and trading financial products involves risk, including the potential loss of some or all of your invested capital.',
    'The value of investments can rise or fall, and no investment strategy can guarantee a profit.',
    'Before investing, you should carefully consider your financial circumstances, investment objectives, experience, and tolerance for risk.',
  ],
  sections: [
    {
      heading: 'General Investment Risk',
      blocks: [
        'Financial markets can be unpredictable.',
        'The price of an investment may decline because of:',
        {
          list: [
            'Market conditions',
            'Economic developments',
            'Interest-rate changes',
            'Inflation',
            'Political events',
            'Company-specific events',
            'Regulatory changes',
            'Changes in investor sentiment',
            'Global events',
          ],
        },
        'You may receive less than the amount you originally invested.',
        'In some circumstances, an investment may lose substantially or entirely its value.',
      ],
    },
    {
      heading: 'Stock Risk',
      blocks: [
        'Stocks represent ownership interests in companies and can fluctuate significantly in value.',
        'The price of a stock may decline because of:',
        {
          list: [
            'Poor company performance',
            'Earnings results',
            'Management changes',
            'Industry conditions',
            'Economic conditions',
            'Market sentiment',
            'Regulatory developments',
          ],
        },
        'There is no guarantee that a stock will increase in value or that you will recover your original investment.',
      ],
    },
    {
      heading: 'Market Volatility',
      blocks: [
        'Markets can experience periods of substantial volatility.',
        'During periods of extreme market activity:',
        {
          list: [
            'Prices may move rapidly',
            'Spreads may increase',
            'Liquidity may decrease',
            'Orders may execute at unexpected prices',
            'Trading may be temporarily restricted',
            'Market data may become delayed',
          ],
        },
        'You should not assume that an investment can always be bought or sold immediately at the displayed price.',
      ],
    },
    {
      heading: 'Cryptocurrency Risk',
      blocks: [
        'Cryptocurrency and digital assets involve significant risks.',
        'Digital assets can experience extreme price volatility and may lose substantial or all of their value.',
        'Additional risks may include:',
        {
          list: [
            'Regulatory changes',
            'Market manipulation',
            'Cybersecurity threats',
            'Blockchain network disruptions',
            'Technology failures',
            'Liquidity limitations',
            'Wallet or transaction errors',
            'Irreversible transactions',
            'Loss or theft of digital assets',
            'Changes to blockchain protocols',
          ],
        },
        'Cryptocurrency investments may have different protections and regulatory treatment from traditional securities.',
        'You should understand the specific risks associated with a digital asset before purchasing it.',
      ],
    },
    {
      heading: 'Gold Risk',
      blocks: [
        'Gold prices can fluctuate based on:',
        {
          list: [
            'Interest rates',
            'Inflation expectations',
            'Currency movements',
            'Economic conditions',
            'Supply and demand',
            'Geopolitical events',
            'Investor sentiment',
          ],
        },
        'Exposure to gold does not guarantee protection against losses.',
        'The specific risks associated with gold depend on how exposure is provided through the HyperStocks platform.',
      ],
    },
    {
      heading: 'Mutual Fund Risk',
      blocks: [
        'Mutual funds invest in portfolios of securities or other assets.',
        'Although diversification may reduce certain risks, it does not eliminate investment risk.',
        'A mutual fund may decline in value because of movements in the underlying investments.',
        'Other risks may include:',
        {
          list: [
            'Market risk',
            'Interest-rate risk',
            'Credit risk',
            'Management risk',
            'Liquidity risk',
            'Sector concentration',
            'Foreign investment risk',
          ],
        },
        'Mutual funds may also have fees and expenses that reduce investment returns.',
      ],
    },
    {
      heading: 'Liquidity Risk',
      blocks: [
        'Some investments may be difficult to sell at the desired price or within the desired timeframe.',
        'During periods of market stress, liquidity may decline significantly.',
        'An investment may therefore have to be sold at a price substantially below its estimated or previously displayed value.',
      ],
    },
    {
      heading: 'Foreign Market Risk',
      blocks: [
        'Investments connected to foreign markets may be affected by:',
        {
          list: [
            'Currency fluctuations',
            'Foreign regulations',
            'Political instability',
            'Economic conditions',
            'Different accounting standards',
            'Market restrictions',
          ],
        },
        'These risks may be greater than those associated with domestic investments.',
      ],
    },
    {
      heading: 'Technology and Cybersecurity Risk',
      blocks: [
        'Electronic trading and financial platforms depend on technology.',
        'Temporary or prolonged disruptions may result from:',
        {
          list: [
            'Internet outages',
            'System failures',
            'Cyberattacks',
            'Software errors',
            'Hardware failures',
            'Third-party service interruptions',
            'Network congestion',
          ],
        },
        'Although HyperStocks maintains security and continuity measures, no system can be guaranteed to operate without interruption.',
      ],
    },
    {
      heading: 'Order Execution Risk',
      blocks: [
        'The price displayed when an order is submitted may differ from the eventual execution price.',
        'This may occur because of:',
        {
          list: [
            'Market volatility',
            'Price movement',
            'Liquidity',
            'Order size',
            'Market conditions',
            'Trading halts',
            'Network or system delays',
          ],
        },
        'A displayed price should not be interpreted as a guaranteed execution price.',
      ],
    },
    {
      heading: 'Past Performance',
      blocks: [
        'Past performance is not a reliable indicator of future results.',
        'Historical returns, charts, rankings, or performance information should not be interpreted as a guarantee that an investment will perform similarly in the future.',
      ],
    },
    {
      heading: 'Diversification Does Not Eliminate Risk',
      blocks: [
        'Diversification can help manage certain investment risks, but it does not guarantee a profit or prevent losses.',
        'A diversified portfolio can still decline substantially during unfavorable market conditions.',
      ],
    },
    {
      heading: 'No Investment Guarantee',
      blocks: [
        'HyperStocks does not guarantee:',
        {
          list: [
            'Investment returns',
            'Preservation of capital',
            'Market performance',
            'Specific execution prices',
            'Investment profitability',
            'Future asset values',
          ],
        },
        'You are responsible for your investment decisions.',
      ],
    },
    {
      heading: 'Seek Professional Advice',
      blocks: [
        'Information provided through HyperStocks is not a substitute for individualized financial, tax, or legal advice.',
        'If you are uncertain about whether an investment is appropriate for you, consider consulting an appropriately qualified professional.',
      ],
    },
  ],
};

/**
 * DISCLOSURES — with three sections carefully handled.
 *
 * The supplied copy for §10, §11 and §12 contains INSTRUCTIONS TO WHOEVER
 * BUILDS THE PAGE, not text for a reader: "Do not insert claims such as 'FINRA
 * member,' 'SIPC protected,' 'SEC registered'…", "Use the official SIPC wording
 * applicable to HyperStocks's actual membership…", "Do not describe brokerage
 * cash as FDIC-insured unless…". Rendering those verbatim would publish a
 * drafting note to customers, so each is honoured as a CONSTRAINT and the
 * customer-facing substance around it is kept:
 *
 *   §10 — no membership, registration or insurance claim is asserted anywhere
 *         on this page. The section says regulatory status depends on the
 *         entity and should be verified with the regulator, which is true and
 *         claims nothing.
 *   §11 — SIPC is DESCRIBED without asserting membership, because HyperStocks
 *         is not a SIPC member: every position here is simulated. Saying "SIPC
 *         protects your account" would be the exact false claim the instruction
 *         exists to prevent. If membership is ever real, replace this section
 *         with SIPC's official wording rather than editing around it.
 *   §12 — the FDIC statement is kept because it is TRUE as written: nothing
 *         here is a bank deposit and nothing is FDIC-insured.
 */
export const DISCLOSURES = {
  id: 'disclosures',
  title: 'Important Disclosures',
  intro: [
    'This page contains important information about HyperStocks, its services, investment products, market information, and the risks associated with investing.',
    'Please read these disclosures carefully before using the HyperStocks platform.',
  ],
  sections: [
    {
      heading: 'Investment Products Carry Risk',
      blocks: [
        'Investing involves risk.',
        'The value of securities, digital assets, commodities, funds, and other investments can increase or decrease.',
        'You may lose some or all of your invested capital.',
      ],
    },
    {
      heading: 'No Investment Advice',
      blocks: [
        'Unless expressly stated otherwise in a separate agreement, information presented through HyperStocks is provided for informational and educational purposes.',
        'Market information, research, educational materials, charts, news, and other content should not be interpreted as individualized investment advice or a recommendation to purchase or sell a particular investment.',
      ],
    },
    {
      heading: 'Market Information',
      blocks: [
        'Market prices, quotes, charts, statistics, news, and other financial information displayed through HyperStocks may be provided by third-party market-data providers.',
        'Market information may be:',
        {
          list: [
            'Delayed',
            'Estimated',
            'Incomplete',
            'Subject to correction',
            'Temporarily unavailable',
          ],
        },
        'You should not assume that displayed information represents a guaranteed executable price.',
      ],
    },
    {
      heading: 'Order Execution',
      blocks: [
        'Submitting an order does not necessarily guarantee execution.',
        'Orders may be rejected, delayed, partially filled, cancelled, or executed at a price different from the price displayed when the order was submitted.',
        'Execution depends on market conditions, liquidity, applicable trading rules, and other factors.',
      ],
    },
    {
      heading: 'Cryptocurrency Disclosure',
      blocks: [
        'Cryptocurrency services may be subject to different regulatory requirements and protections than traditional securities.',
        'Digital assets can experience significant price volatility and may involve additional risks relating to custody, technology, blockchain networks, liquidity, cybersecurity, and regulatory changes.',
        'Only invest amounts you can afford to lose.',
      ],
    },
    {
      heading: 'Gold Disclosure',
      blocks: [
        'Gold-related investments may involve risks associated with commodity prices, market conditions, liquidity, interest rates, currencies, and the specific structure of the product through which exposure is obtained.',
        'Gold does not guarantee preservation of capital.',
      ],
    },
    {
      heading: 'Mutual Fund Disclosure',
      blocks: [
        'Mutual funds are subject to investment risk and may lose value.',
        'Fund expenses, management fees, transaction costs, and other charges can affect your overall return.',
        'Each fund has its own investment strategy, risks, fees, and objectives. Investors should review the applicable prospectus and fund documentation before investing.',
      ],
    },
    {
      heading: 'Fees and Costs',
      blocks: [
        'Investment products and services may involve fees and expenses.',
        'These may include:',
        {
          list: [
            'Trading-related charges',
            'Fund expenses',
            'Spreads',
            'Payment-processing charges',
            'Withdrawal fees',
            'Other applicable service fees',
          ],
        },
        'Applicable fees should be reviewed before completing a transaction.',
      ],
    },
    {
      heading: 'Third-Party Services',
      blocks: [
        'HyperStocks may rely on third-party providers for certain services, including:',
        {
          list: [
            'Clearing',
            'Custody',
            'Banking',
            'Payment processing',
            'Market data',
            'Identity verification',
            'Technology infrastructure',
            'Security',
            'Digital-asset services',
          ],
        },
        'Third-party services may be subject to separate terms, limitations, and policies.',
      ],
    },
    {
      heading: 'Regulatory Status',
      blocks: [
        "HyperStocks's regulatory status, registrations, licenses, memberships, and permitted activities depend on the specific legal entity providing each service.",
        'Where applicable, information regarding registrations and regulatory affiliations should be verified through the relevant regulatory authority.',
        'No representation of membership in, or registration with, any particular regulator or investor-protection scheme is made on this page.',
      ],
    },
    {
      heading: 'SIPC',
      blocks: [
        'SIPC protection is not the same as protection against investment losses.',
        'SIPC generally protects eligible customers against the loss of cash and securities held by a failed SIPC-member brokerage firm, subject to statutory limits and eligibility requirements. It does not protect against a decline in the market value of an investment.',
        'Where a SIPC-member broker-dealer provides a service, the applicable SIPC disclosure will be presented in the form required for that customer relationship.',
      ],
    },
    {
      heading: 'No FDIC Guarantee',
      blocks: [
        'Unless specifically stated otherwise for an eligible bank deposit product, investments offered through HyperStocks are not bank deposits and are not insured by the FDIC.',
        'Investment values may fluctuate and investors may lose money.',
      ],
    },
    {
      heading: 'Conflicts of Interest',
      blocks: [
        'HyperStocks and its affiliates may have relationships with third-party service providers, financial institutions, investment-product providers, market-data vendors, or other parties.',
        'Where applicable, HyperStocks maintains policies and disclosures designed to identify, manage, and disclose material conflicts of interest.',
      ],
    },
    {
      heading: 'Account Restrictions',
      blocks: [
        'HyperStocks may place restrictions on accounts or transactions when necessary for:',
        {
          list: [
            'Security',
            'Fraud prevention',
            'Identity verification',
            'Regulatory compliance',
            'Legal requirements',
            'Transaction review',
            'Risk management',
          ],
        },
        'Restrictions may affect deposits, withdrawals, trading, or other account functionality.',
      ],
    },
    {
      heading: 'Tax Considerations',
      blocks: [
        'Investment transactions may have tax consequences.',
        'HyperStocks may provide tax-related documents or transaction information where required.',
        'However, HyperStocks does not provide individualized tax advice.',
        'Consult a qualified tax professional regarding your specific circumstances.',
      ],
    },
    {
      heading: 'No Guarantee of Availability',
      blocks: [
        'HyperStocks works to maintain reliable access to its platform but does not guarantee uninterrupted availability.',
        'Services may be temporarily unavailable because of:',
        {
          list: [
            'Maintenance',
            'System failures',
            'Cybersecurity incidents',
            'Network disruptions',
            'Market events',
            'Third-party outages',
            'Regulatory requirements',
            'Circumstances beyond our control',
          ],
        },
      ],
    },
    {
      heading: 'Account Security',
      blocks: [
        'You are responsible for protecting your account credentials and authentication information.',
        'HyperStocks will never ask you to disclose your password or authentication code through an unsolicited communication.',
        'If you suspect unauthorized access, contact HyperStocks immediately.',
      ],
    },
    {
      heading: 'Changes to Products and Services',
      blocks: [
        'HyperStocks may modify, suspend, or discontinue products and services where permitted by applicable law.',
        'The availability of particular assets, markets, features, and funding methods may change over time.',
      ],
    },
    {
      heading: 'Important Investor Reminder',
      blocks: [
        'Investing involves risk.',
        'Before investing through HyperStocks, consider your:',
        {
          list: [
            'Investment objectives',
            'Financial circumstances',
            'Investment experience',
            'Risk tolerance',
            'Time horizon',
          ],
        },
        'Never invest money you cannot afford to lose.',
      ],
    },
    {
      heading: 'Contact HyperStocks',
      blocks: [
        'Questions regarding these disclosures can be directed to:',
        { contact: { name: 'HyperStocks Legal & Compliance', email: SUPPORT_EMAIL } },
      ],
    },
  ],
};

export const ACCOUNT_SECURITY = {
  id: 'account-security',
  title: 'Account Security',
  intro: [
    'Your Account. Your Assets. Protected.',
    'Security is fundamental to the way HyperStocks operates. We use multiple layers of protection to help safeguard your account, personal information, and trading activity while you focus on the markets.',
    'From account authentication and data encryption to transaction monitoring and fraud prevention, our security framework is designed to provide a dependable environment for modern trading.',
  ],
  sections: [
    {
      heading: 'Security Built Into Every Layer',
      blocks: [
        'Your security should not depend on a single protection. HyperStocks uses multiple safeguards across your account, platform, and trading activity to help protect against unauthorized access and suspicious activity.',
      ],
    },
    {
      heading: 'Secure Account Access',
      blocks: [
        'Your account is protected with secure authentication measures designed to prevent unauthorized access. We continuously improve our access controls to help keep your account and personal information secure.',
      ],
    },
    {
      heading: 'Data Encryption',
      blocks: [
        'Sensitive information is protected using modern encryption technologies. Data is secured during transmission and while stored, helping protect your personal and financial information.',
      ],
    },
    {
      heading: 'Transaction Monitoring',
      blocks: [
        'We monitor account and transaction activity for unusual patterns that may indicate suspicious or unauthorized activity. When potential risks are identified, additional verification or account restrictions may be applied.',
      ],
    },
    {
      heading: 'Fraud Prevention',
      blocks: [
        'Our systems are designed to identify and respond to suspicious activity across the platform. Security checks may be triggered when activity appears unusual or inconsistent with normal account behavior.',
      ],
    },
    {
      heading: 'Protection Beyond Your Password',
      blocks: [
        'Your account security does not stop at login.',
        'We take a layered approach to protecting your account, combining authentication, monitoring, encryption, verification, and operational controls to reduce security risks throughout your trading experience.',
      ],
    },
    {
      heading: 'You Play an Important Role',
      blocks: [
        'Even the strongest security systems work best when users follow good security practices.',
        'Never share:',
        {
          list: [
            'Your password',
            'Authentication codes',
            'Recovery codes',
            'Private keys',
            'Wallet recovery phrases',
            'Sensitive account information',
          ],
        },
        'Always:',
        {
          list: [
            'Use a strong, unique password',
            'Keep your authentication methods secure',
            'Review account activity regularly',
            'Keep your contact information up to date',
            'Contact HyperStocks if something looks suspicious',
          ],
        },
      ],
    },
    {
      heading: "Something Doesn't Look Right?",
      blocks: [
        'If you notice suspicious activity, an unfamiliar login, or a transaction you did not authorize, contact our security team immediately.',
      ],
    },
    {
      heading: 'Report a Security Issue',
      blocks: [
        { contact: { name: 'HyperStocks Security', email: 'security@hyperstocks.app' } },
      ],
    },
  ],
};
export const DOCUMENTS = {
  "account-security": ACCOUNT_SECURITY,
  privacy: PRIVACY,
  'financial-privacy': FINANCIAL_PRIVACY,
  terms: TERMS,

  'risk-disclosure': RISK,
  disclosures: DISCLOSURES,
};
