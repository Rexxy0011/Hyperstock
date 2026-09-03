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
    'At HyperStocks, we believe your financial information deserves the same level of care as your investments.',
    'This Privacy Policy explains how HyperStocks collects, uses, protects, stores, and shares information when you visit our website, create an account, use our platform, or interact with our services.',
    'Because HyperStocks provides financial services, we may collect information necessary to establish and maintain your account, verify your identity, process transactions, provide investment services, comply with applicable laws, and protect the integrity of our platform.',
  ],
  sections: [
    {
      heading: 'Information We Collect',
      blocks: [
        'Depending on how you interact with HyperStocks, we may collect several categories of information.',
        { subheading: 'Personal Information' },
        'This may include:',
        {
          list: [
            'Full legal name',
            'Date of birth',
            'Residential address',
            'Email address',
            'Telephone number',
            'Government-issued identification',
            'Social Security number or other tax identification information',
            'Citizenship and residency information',
            'Employment information',
            'Financial information',
            'Income and net-worth information',
            'Investment experience and objectives',
            'Information required for identity verification',
          ],
        },
        'We collect information necessary to establish and maintain your brokerage relationship and satisfy applicable regulatory and compliance requirements.',
        { subheading: 'Financial Information' },
        'When you fund, trade, or withdraw from your account, we may collect information relating to:',
        {
          list: [
            'Bank accounts',
            'Payment methods',
            'Deposit and withdrawal activity',
            'Account balances',
            'Trading activity',
            'Investment positions',
            'Transaction history',
            'Cryptocurrency transactions, where applicable',
          ],
        },
        { subheading: 'Technical Information' },
        'When you use our website or platform, we may automatically collect information such as:',
        {
          list: [
            'IP address',
            'Browser type',
            'Device information',
            'Operating system',
            'Login information',
            'Approximate location',
            'Pages visited',
            'Referral information',
            'Platform usage',
            'Security and authentication events',
          ],
        },
      ],
    },
    {
      heading: 'How We Use Your Information',
      blocks: [
        'HyperStocks may use collected information to:',
        {
          list: [
            'Open and maintain your account',
            'Verify your identity',
            'Process deposits and withdrawals',
            'Execute and maintain records of transactions',
            'Provide investment and trading services',
            'Maintain your portfolio and account records',
            'Communicate with you',
            'Provide customer support',
            'Detect and prevent fraud',
            'Monitor suspicious activity',
            'Protect our systems and customers',
            'Meet legal and regulatory obligations',
            'Conduct internal risk management',
            'Improve our platform and services',
            'Maintain accurate financial and business records',
          ],
        },
        'We do not use customer information for purposes that are incompatible with the purposes described in this Privacy Policy or applicable disclosures.',
      ],
    },
    {
      heading: 'How We Share Information',
      blocks: [
        'HyperStocks may share information when necessary to provide our services, operate our business, or comply with applicable requirements.',
        'Depending on the circumstances, information may be shared with:',
        {
          list: [
            'Clearing and custody providers',
            'Banking and payment providers',
            'Identity verification providers',
            'Fraud prevention providers',
            'Technology and infrastructure providers',
            'Professional advisers',
            'Auditors',
            'Regulators and government authorities',
            'Law enforcement when legally required',
            'Service providers acting on our behalf',
          ],
        },
        'We do not sell your personal information simply because you maintain an account with HyperStocks.',
        'For customers of covered financial institutions, federal privacy rules such as Regulation S-P govern certain disclosures of nonpublic personal information.',
      ],
    },
    {
      heading: 'Financial Privacy',
      blocks: [
        'HyperStocks may collect nonpublic personal information in connection with your financial relationship with us.',
        'This information may include information you provide on applications and forms, information relating to your transactions, and information obtained from permitted third-party sources.',
        'We maintain policies and procedures designed to safeguard customer records and information. Regulation S-P requires covered broker-dealers and other financial institutions to maintain safeguards addressing the security and confidentiality of customer information.',
        'Where applicable, HyperStocks will provide additional privacy disclosures required under federal or state law.',
      ],
    },
    {
      heading: 'Data Security',
      blocks: [
        'We use administrative, technical, and organizational safeguards designed to protect personal and financial information against unauthorized access, loss, misuse, alteration, or disclosure.',
        'Security measures may include:',
        {
          list: [
            'Encryption',
            'Access controls',
            'Authentication mechanisms',
            'Monitoring systems',
            'Security logging',
            'Network protections',
            'Employee access restrictions',
            'Fraud detection',
            'Incident-response procedures',
          ],
        },
        'No internet transmission or electronic storage system can be guaranteed to be completely secure.',
      ],
    },
    {
      heading: 'Identity Verification and Compliance',
      blocks: [
        'Financial institutions may be required to collect and verify information about their customers.',
        'HyperStocks may use personal information to perform:',
        {
          list: [
            'Identity verification',
            'Customer due diligence',
            'Fraud prevention',
            'Sanctions screening',
            'Anti-money-laundering checks',
            'Regulatory reporting',
            'Risk assessments',
          ],
        },
        'Information collected for these purposes may be retained as required by applicable law.',
      ],
    },
    {
      heading: 'Data Retention',
      blocks: [
        'We retain personal and financial information for as long as reasonably necessary to:',
        {
          list: [
            'Provide our services',
            'Maintain your account',
            'Meet contractual obligations',
            'Satisfy legal and regulatory requirements',
            'Resolve disputes',
            'Prevent fraud',
            'Maintain financial records',
            'Enforce our agreements',
          ],
        },
        'Financial-service recordkeeping requirements may require us to retain certain information even after an account has been closed.',
      ],
    },
    {
      heading: 'Your Privacy Rights',
      blocks: [
        'Depending on where you live and the laws applicable to you, you may have rights concerning your personal information.',
        'These may include rights to:',
        {
          list: [
            'Request access to certain information',
            'Request correction of inaccurate information',
            'Request deletion where legally permitted',
            'Request information about how data is used',
            'Opt out of certain forms of marketing',
            'Exercise applicable state privacy rights',
          ],
        },
        'Some rights may be limited by financial-services, legal, regulatory, fraud-prevention, or record-retention requirements.',
        'For example, California privacy law requires covered businesses to provide specific information about collection practices and applicable consumer rights.',
      ],
    },
    {
      heading: 'Changes to This Privacy Policy',
      blocks: [
        'We may update this Privacy Policy periodically to reflect changes to our services, technology, legal obligations, or privacy practices.',
        'When we make material changes, we may provide additional notice where required.',
        'The Last Updated date at the top of this policy indicates when it was most recently revised.',
      ],
    },
    {
      heading: 'Contact Us',
      blocks: [
        'If you have questions about this Privacy Policy or your personal information, contact:',
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
    'These Terms of Service govern your access to and use of the HyperStocks website, applications, accounts, and related services.',
    'By creating an account or using HyperStocks, you acknowledge that you have read and agree to these Terms.',
  ],
  sections: [
    {
      heading: 'Eligibility',
      blocks: [
        "You must satisfy HyperStocks's eligibility requirements to open and maintain an account.",
        'You may be required to:',
        {
          list: [
            'Meet applicable age requirements',
            'Provide accurate personal information',
            'Complete identity verification',
            'Provide requested documentation',
            'Satisfy applicable regulatory requirements',
            'Maintain only accounts permitted under our policies',
          ],
        },
        'We may refuse, restrict, suspend, or terminate an account where permitted by law.',
      ],
    },
    {
      heading: 'Your Account',
      blocks: [
        'You are responsible for maintaining the confidentiality of your account credentials.',
        'You must notify HyperStocks promptly if you believe:',
        {
          list: [
            'Your password has been compromised',
            'Your account has been accessed without authorization',
            'You see an unfamiliar transaction',
            'Your personal information has been compromised',
          ],
        },
        'You are responsible for information submitted through your account being accurate and current.',
      ],
    },
    {
      heading: 'Investment Services',
      blocks: [
        'HyperStocks may provide access to multiple investment products and markets, including, where available:',
        {
          list: [
            'Stocks',
            'Mutual funds',
            'Gold',
            'Cryptocurrency',
            'Other supported investment products',
          ],
        },
        'Availability varies according to account eligibility, jurisdiction, product availability, and applicable regulations.',
      ],
    },
    {
      heading: 'Investment Risk',
      blocks: [
        'Investing involves risk.',
        'The value of investments can increase or decrease, and you may lose some or all of your invested capital.',
        'Cryptocurrency and other volatile assets may experience substantial price movements.',
        'Past performance does not guarantee future results.',
        'HyperStocks does not guarantee that any investment will achieve a particular return.',
      ],
    },
    {
      heading: 'No Guarantee of Execution',
      blocks: [
        'Orders may not always execute at the price displayed when an order is submitted.',
        'Market conditions, liquidity, trading halts, exchange rules, network conditions, technical interruptions, and other circumstances may affect execution.',
      ],
    },
    {
      heading: 'Account Funding',
      blocks: [
        'You may fund your account using funding methods made available through HyperStocks.',
        'Deposits may be subject to:',
        {
          list: [
            'Verification',
            'Processing periods',
            'Funding limits',
            'Compliance reviews',
            'Transaction monitoring',
            'Additional restrictions',
          ],
        },
        'Funds may not immediately become available for trading after a deposit is initiated.',
      ],
    },
    {
      heading: 'Withdrawals',
      blocks: [
        'Withdrawal requests may be subject to verification, account restrictions, processing requirements, and applicable compliance procedures.',
        'HyperStocks may delay or restrict a withdrawal when reasonably necessary to investigate suspected fraud, unauthorized activity, regulatory concerns, or other circumstances permitted by law.',
      ],
    },
    {
      heading: 'Cryptocurrency Transactions',
      blocks: [
        'Where cryptocurrency services are available, digital-asset transactions may involve additional risks and requirements.',
        'Blockchain transactions may be irreversible.',
        'You are responsible for selecting the correct asset, network, and destination information when initiating a cryptocurrency transaction.',
        'HyperStocks is not responsible for losses caused by incorrect wallet addresses, unsupported networks, or user errors, except where applicable law provides otherwise.',
      ],
    },
    {
      heading: 'Fees',
      blocks: [
        'Certain services, products, transactions, or payment methods may be subject to fees.',
        'Applicable fees will be disclosed through the platform or relevant agreements.',
        'You are responsible for reviewing applicable fees before completing a transaction.',
      ],
    },
    {
      heading: 'Prohibited Activities',
      blocks: [
        'You may not use HyperStocks to:',
        {
          list: [
            'Commit fraud',
            'Launder money',
            'Evade sanctions',
            'Conduct unlawful transactions',
            'Misrepresent your identity',
            'Circumvent account restrictions',
            'Abuse platform functionality',
            'Attempt unauthorized access',
            'Interfere with platform security',
            'Use the platform for unlawful purposes',
          ],
        },
        'We may suspend or terminate accounts involved in prohibited activity.',
      ],
    },
    {
      heading: 'Suspension and Termination',
      blocks: [
        'HyperStocks may suspend, restrict, or terminate your access where permitted by law, including where:',
        {
          list: [
            'You violate these Terms',
            'Information provided is inaccurate',
            'Suspicious activity is detected',
            'Required verification cannot be completed',
            'We are required to do so by law or regulation',
            'Continued access presents a security or compliance risk',
          ],
        },
      ],
    },
    {
      heading: 'Electronic Communications',
      blocks: [
        'You agree that HyperStocks may communicate with you electronically regarding your account, transactions, notices, disclosures, security events, and other matters.',
        'You are responsible for maintaining a valid email address and reviewing communications sent to you.',
      ],
    },
    {
      heading: 'Intellectual Property',
      blocks: [
        'All HyperStocks trademarks, logos, software, designs, content, and platform technology are owned by or licensed to HyperStocks and may not be copied, modified, distributed, or used without authorization.',
      ],
    },
    {
      heading: 'Third-Party Services',
      blocks: [
        'HyperStocks may integrate with third-party service providers.',
        'Third-party services may have their own terms and privacy policies. HyperStocks is not responsible for third-party services except to the extent required by applicable law.',
      ],
    },
    {
      heading: 'Disclaimer',
      blocks: [
        'Except where expressly required by law, HyperStocks does not guarantee that the platform will always be uninterrupted, error-free, or available.',
        'Market data and other information may be delayed, incomplete, or inaccurate.',
      ],
    },
    {
      heading: 'Limitation of Liability',
      blocks: [
        'To the maximum extent permitted by applicable law, HyperStocks will not be liable for indirect, incidental, consequential, special, or punitive damages arising from your use of the platform.',
        'Nothing in these Terms limits liability where such limitation is prohibited by law.',
      ],
    },
    {
      heading: 'Changes to These Terms',
      blocks: [
        'We may modify these Terms from time to time.',
        'Updated Terms will be posted on the website with a revised effective date. Where required, we will provide additional notice.',
        'Your continued use of the platform following the effective date constitutes acceptance of the revised Terms to the extent permitted by law.',
      ],
    },
    {
      heading: 'Governing Law',
      blocks: [
        "These Terms are governed by applicable federal law and the laws of the jurisdiction specified in HyperStocks's account agreements and other applicable legal documents.",
      ],
    },
    {
      heading: 'Contact',
      blocks: [{ contact: { name: 'HyperStocks Legal Department', email: SUPPORT_EMAIL } }],
    },
  ],
};

export const FINANCIAL_PRIVACY = {
  id: 'financial-privacy',
  title: 'Financial Privacy Notice',
  intro: [
    'At HyperStocks, protecting the privacy of your financial information is an important part of the relationship we maintain with our customers.',
    'This Financial Privacy Notice explains how we collect, use, maintain, and disclose certain nonpublic personal information in connection with your financial relationship with HyperStocks.',
    'This notice supplements our general Privacy Policy and applies to customers and prospective customers where applicable.',
  ],
  sections: [
    {
      heading: 'Information We Collect',
      blocks: [
        'In connection with providing financial services, we may collect information about you from a variety of sources.',
        { subheading: 'Information You Provide' },
        'This may include:',
        {
          list: [
            'Your name',
            'Date of birth',
            'Residential address',
            'Email address',
            'Telephone number',
            'Government identification',
            'Tax identification information',
            'Employment information',
            'Financial information',
            'Investment experience',
            'Investment objectives',
            'Income and net worth information',
            'Account applications and forms',
          ],
        },
        { subheading: 'Information About Your Transactions' },
        'We may collect information relating to your relationship with HyperStocks, including:',
        {
          list: [
            'Account balances',
            'Deposits',
            'Withdrawals',
            'Purchases',
            'Sales',
            'Trading activity',
            'Investment positions',
            'Account transfers',
            'Payment activity',
            'Cryptocurrency transactions, where applicable',
          ],
        },
        { subheading: 'Information From Third Parties' },
        'Where permitted by applicable law, we may obtain information from sources such as:',
        {
          list: [
            'Identity verification services',
            'Credit or financial institutions',
            'Public databases',
            'Regulatory databases',
            'Fraud prevention providers',
            'Other service providers',
            'Other financial institutions',
          ],
        },
      ],
    },
    {
      heading: 'How We Use Financial Information',
      blocks: [
        'We may use financial information to:',
        {
          list: [
            'Establish and maintain your account',
            'Verify your identity',
            'Process transactions',
            'Provide brokerage and investment services',
            'Process deposits and withdrawals',
            'Maintain accurate account records',
            'Detect and prevent fraud',
            'Monitor suspicious activity',
            'Conduct compliance reviews',
            'Meet regulatory obligations',
            'Communicate with you',
            'Protect our customers and platform',
            'Resolve disputes',
            'Improve our services',
          ],
        },
      ],
    },
    {
      heading: 'When We Share Information',
      blocks: [
        'HyperStocks may share information about you when permitted or required by law.',
        'Information may be shared with companies and organizations that help us operate our business, including:',
        {
          list: [
            'Clearing firms',
            'Custodians',
            'Banks',
            'Payment processors',
            'Identity verification providers',
            'Fraud prevention services',
            'Technology providers',
            'Professional advisers',
            'Auditors',
            'Regulators',
            'Government authorities',
            'Law enforcement agencies',
          ],
        },
        'When service providers receive information on our behalf, we take steps designed to ensure that information is handled appropriately.',
      ],
    },
    {
      heading: 'Your Privacy Choices',
      blocks: [
        'Depending on applicable law, you may have certain rights concerning your personal information.',
        'However, financial-services laws and regulatory obligations may limit our ability to delete, restrict, or modify certain information.',
        'For example, we may be required to retain transaction records or customer information for specified periods.',
      ],
    },
    {
      heading: 'Protecting Your Information',
      blocks: [
        'HyperStocks maintains administrative, technical, and organizational safeguards designed to protect customer information.',
        'These safeguards may include:',
        {
          list: [
            'Encryption',
            'Authentication controls',
            'Access restrictions',
            'Security monitoring',
            'Fraud detection',
            'Network security',
            'Employee controls',
            'Incident-response procedures',
          ],
        },
        'No security system can eliminate every possible risk.',
      ],
    },
    {
      heading: 'Former Customers',
      blocks: [
        'We continue to protect certain information about former customers in accordance with applicable law and our information-security policies.',
        'We may retain information after an account is closed where necessary for regulatory, legal, accounting, fraud-prevention, or other legitimate purposes.',
      ],
    },
    {
      heading: 'Questions About Financial Privacy',
      blocks: [
        'For questions regarding this notice or the privacy of your financial information:',
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

export const DOCUMENTS = {
  privacy: PRIVACY,
  'financial-privacy': FINANCIAL_PRIVACY,
  terms: TERMS,

  'risk-disclosure': RISK,
  disclosures: DISCLOSURES,
};
