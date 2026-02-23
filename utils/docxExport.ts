import { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink, AlignmentType } from 'docx';
import { marked, Token, TokensList } from 'marked';

// Helper to extract or convert `<claim>` tags
const preProcessClaims = (text: string): string => {
    if (!text) return '';

    const claimTagRegex = /<claim([\s\S]*?)>([\s\S]*?)<\/claim>/g;

    return text.replace(claimTagRegex, (match, attributesString, content) => {
        const attrRegex = /(\w+)="([^"]*)"/g;
        const attrs: Record<string, string> = {};
        let attrMatch;

        while ((attrMatch = attrRegex.exec(attributesString)) !== null) {
            attrs[attrMatch[1]] = attrMatch[2];
        }

        const source = attrs.source || 'Unknown Source';
        const page = attrs.page || '';

        // If it's a URL, make it a standard markdown link
        if (source.startsWith('http') || source.startsWith('www')) {
            const finalSource = source.startsWith('www') ? `https://${source}` : source;
            return `[${content}](${finalSource})`;
        }

        // Otherwise just append the source reference, including page if it exists
        const pageSuffix = page ? ` (Page ${page})` : '';
        return `${content} [${source}${pageSuffix}]`;
    });
};

const buildParagraphsFromTokens = (tokens: TokensList | Token[]): Paragraph[] => {
    const paragraphs: Paragraph[] = [];

    const processTokens = (tks: Token[], level = 0): void => {
        for (const token of tks) {
            switch (token.type) {
                case 'heading': {
                    let hLevel: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1;
                    if (token.depth === 2) hLevel = HeadingLevel.HEADING_2;
                    else if (token.depth === 3) hLevel = HeadingLevel.HEADING_3;
                    else if (token.depth === 4) hLevel = HeadingLevel.HEADING_4;
                    else if (token.depth >= 5) hLevel = HeadingLevel.HEADING_5;

                    paragraphs.push(new Paragraph({
                        text: token.text,
                        heading: hLevel,
                        spacing: { before: 240, after: 120 }
                    }));
                    break;
                }
                case 'paragraph': {
                    if (token.tokens) {
                        paragraphs.push(new Paragraph({
                            children: buildRunsFromInlineTokens(token.tokens),
                            spacing: { after: 120 }
                        }));
                    } else {
                        paragraphs.push(new Paragraph({
                            text: token.text,
                            spacing: { after: 120 }
                        }));
                    }
                    break;
                }
                case 'list': {
                    token.items.forEach((item, index) => {
                        const isOrdered = token.ordered;

                        // Handle list item text
                        const itemTokens = item.tokens || [];
                        let pChildren: any[] = [];

                        // We try to extract text/links from within the list item
                        itemTokens.forEach(t => {
                            if (t.type === 'text' && t.tokens) {
                                pChildren.push(...buildRunsFromInlineTokens(t.tokens));
                            } else if (t.type === 'text') {
                                pChildren.push(new TextRun({ text: t.text }));
                            }
                        });

                        if (pChildren.length === 0) {
                            pChildren.push(new TextRun({ text: item.text }));
                        }

                        paragraphs.push(new Paragraph({
                            children: pChildren,
                            bullet: isOrdered ? undefined : { level: 0 },
                            numbering: isOrdered ? { reference: "orderedList", level: 0 } : undefined,
                            spacing: { after: 80 }
                        }));
                    });
                    break;
                }
                case 'space':
                case 'br':
                    paragraphs.push(new Paragraph({ text: '' }));
                    break;
                case 'text':
                    if (token.tokens) {
                        paragraphs.push(new Paragraph({
                            children: buildRunsFromInlineTokens(token.tokens)
                        }));
                    } else {
                        paragraphs.push(new Paragraph({ text: token.text }));
                    }
                    break;
                default:
                    // Fallback for unsupported tokens (e.g., tables, quotes) 
                    // To keep it simple, we just emit raw text for now
                    if ((token as any).text) {
                        paragraphs.push(new Paragraph({
                            text: (token as any).text,
                            spacing: { after: 120 }
                        }));
                    }
                    break;
            }
        }
    };

    processTokens(tokens);
    return paragraphs;
};

const buildRunsFromInlineTokens = (tokens: Token[]): (TextRun | ExternalHyperlink)[] => {
    const runs: (TextRun | ExternalHyperlink)[] = [];

    for (const token of tokens) {
        if (token.type === 'strong') {
            runs.push(new TextRun({ text: token.text, bold: true }));
        } else if (token.type === 'em') {
            runs.push(new TextRun({ text: token.text, italics: true }));
        } else if (token.type === 'codespan') {
            runs.push(new TextRun({ text: token.text, font: 'Courier New', shading: { type: 'solid', color: 'EFEFEF' } }));
        } else if (token.type === 'link') {
            runs.push(new ExternalHyperlink({
                link: token.href,
                children: [
                    new TextRun({
                        text: token.text,
                        color: '0563C1', // Standard blue link
                        underline: { type: 'single' }
                    })
                ]
            }));
        } else if (token.type === 'text') {
            // Decode HTML entities
            const decoded = token.text
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");

            runs.push(new TextRun({ text: decoded }));
        } else if ((token as any).text) {
            runs.push(new TextRun({ text: (token as any).text }));
        }
    }

    return runs;
};


export const exportReportToDocx = async (reportContent: string, title: string = "Research Report") => {

    // 1. Convert <claim> to markdown links/text
    const processedContent = preProcessClaims(reportContent);

    // 2. Parse markdown to tokens
    const tokens = marked.lexer(processedContent);

    // 3. Convert tokens to DOCX Paragraphs
    const paragraphs = buildParagraphsFromTokens(tokens);

    // Auto-add a title
    paragraphs.unshift(
        new Paragraph({
            text: title,
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 }
        })
    );

    // 4. Build doc
    const doc = new Document({
        numbering: {
            config: [
                {
                    reference: "orderedList",
                    levels: [
                        {
                            level: 0,
                            format: "decimal",
                            text: "%1.",
                            alignment: AlignmentType.START,
                            style: {
                                paragraph: {
                                    indent: { left: 720, hanging: 360 },
                                },
                            },
                        }
                    ]
                }
            ]
        },
        sections: [{
            properties: {},
            children: paragraphs
        }]
    });

    // 5. Generate and download
    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;

    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.download = `${safeTitle}.docx`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
};
