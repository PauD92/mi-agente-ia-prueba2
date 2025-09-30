// scripts/generate-kb.ts (Versión mejorada)

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';
import * as babelParser from '@babel/parser';
import _traverse, { NodePath } from '@babel/traverse';
import {
  isVariableDeclaration,
  isIdentifier,
  isObjectExpression,
  isObjectProperty,
  isStringLiteral,
  isBooleanLiteral,
  isNumericLiteral,
  VariableDeclarator,
  ObjectProperty,
  ExportNamedDeclaration,
  Node as BabelNode,
} from '@babel/types';
import { Project, PropertyDeclaration, Node, SyntaxKind, Type } from 'ts-morph';
// NUEVO: Dependencias para parsear MDX
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import { visit } from 'unist-util-visit';
import { Root } from 'mdast';


const traverse = (_traverse as any).default ?? _traverse;

// --- CONFIGURACIÓN ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_PATH = path.resolve(__dirname, '../../uniframe/projects/uniframe');
const STORIES_PATH = path.join(BASE_PATH, 'stories');
const COMPONENTS_PATH = path.join(BASE_PATH, 'components');
const OUTPUT_PATH = path.join(process.cwd(), 'knowledge_base.json');
// --- FIN CONFIGURACIÓN ---

// MODIFICADO: Interfaces más detalladas
interface ComponentInput {
  nombre: string;
  tipo: string;
  descripcion?: string;
  valorPorDefecto?: string;
  valoresPermitidos?: string[];
}

interface ComponentOutput {
    nombre: string;
    tipo: string;
    descripcion?: string;
}

interface ComponentExample {
  nombre: string;
  configuracion: Record<string, any>;
}

interface ComponentDocumentation {
    descripcionGeneral?: string;
    anatomia?: string[];
    variantes?: { nombre: string; descripcion: string }[];
    accesibilidad?: string[];
}

interface ComponentInfo {
  componenteNombre: string;
  selector: string;
  aiHint: string;
  api: {
    inputs: ComponentInput[];
    outputs: ComponentOutput[];
  };
  documentacion: ComponentDocumentation;
  ejemplos: ComponentExample[];
}

// Helper para convertir nodos de Babel a valores JS
function babelNodeToJsValue(node: BabelNode): any {
    if (isStringLiteral(node)) return node.value;
    if (isBooleanLiteral(node)) return node.value;
    if (isNumericLiteral(node)) return node.value;
    if (isObjectExpression(node)) {
        const obj: Record<string, any> = {};
        node.properties.forEach(prop => {
            if (isObjectProperty(prop) && isIdentifier(prop.key)) {
                obj[prop.key.name] = babelNodeToJsValue(prop.value);
            }
        });
        return obj;
    }
    return null;
}

async function extractComponentData(componentPath: string): Promise<{ selector: string; inputs: ComponentInput[], outputs: ComponentOutput[] } | null> {
    const foundPath = [componentPath].find(p => fs.existsSync(p));
    if (!foundPath) {
        console.warn(`      - WARN: No se encontró el archivo de componente en: ${componentPath}`);
        return null;
    }

  const project = new Project();
  const sourceFile = project.addSourceFileAtPath(foundPath);
  const componentClass = sourceFile.getClasses().find(c => c.getDecorator('Component'));
  if (!componentClass) return null;

  const componentDecorator = componentClass.getDecorator('Component')!;
  const decoratorArg = componentDecorator.getArguments()[0];
  let selector = '';

  if (decoratorArg && Node.isObjectLiteralExpression(decoratorArg)) {
    const selectorProp = decoratorArg.getProperty('selector');
    if (selectorProp) {
      selector = (selectorProp.getStructure() as any).initializer.replace(/['"`]/g, '');
    }
  }

  // MODIFICADO: Extrae Inputs y Outputs
  const inputs: ComponentInput[] = [];
  const outputs: ComponentOutput[] = [];

  const processProperty = (prop: PropertyDeclaration) => {
    const propName = prop.getName();
    const propType = prop.getType();
    const propTypeText = propType.getText();
    const initializer = prop.getInitializer();

    let valoresPermitidos: string[] | undefined = undefined;
    if (propType.isUnion()) {
        valoresPermitidos = propType.getUnionTypes()
            .filter(t => t.isStringLiteral())
            .map(t => t.getLiteralValue() as string);
        if (valoresPermitidos.length === 0) valoresPermitidos = undefined;
    }

    return {
        nombre: propName,
        tipo: propTypeText,
        valorPorDefecto: initializer?.getText(),
        ...(valoresPermitidos && { valoresPermitidos })
    };
  };

  componentClass.getProperties().forEach((prop: PropertyDeclaration) => {
    if (prop.getDecorator('Input')) {
      inputs.push(processProperty(prop));
    }
    if (prop.getDecorator('Output')) {
        const eventEmitterType = prop.getType().getAliasTypeArguments().map(t=>t.getText()).join(', ');
        outputs.push({
            nombre: prop.getName(),
            tipo: eventEmitterType || 'void',
        });
    }
  });

  return { selector, inputs, outputs };
}

function extractStorybookData(content: string): { componenteNombre: string, aiHint: string, ejemplos: ComponentExample[], argTypeDescriptions: Map<string, string> } {
    const ast = babelParser.parse(content, {
        sourceType: 'module',
        plugins: ['typescript', 'decorators-legacy'],
        errorRecovery: true,
    });

    let componenteNombre = '';
    let aiHint = 'COMPLETAR HINT PARA LA IA';
    const argTypeDescriptions = new Map<string, string>();
    const ejemplos: ComponentExample[] = [];

    traverse(ast, {
        VariableDeclarator(path: NodePath<VariableDeclarator>) {
            if (isIdentifier(path.node.id) && path.node.id.name === 'meta' && isObjectExpression(path.node.init)) {
                // ... (extracción de aiHint y title sin cambios)
                path.node.init.properties.forEach(prop => {
                    if (isObjectProperty(prop) && isIdentifier(prop.key)) {
                        if (prop.key.name === 'title' && isStringLiteral(prop.value)) {
                            componenteNombre = prop.value.value;
                        }
                        if (prop.key.name === 'argTypes' && isObjectExpression(prop.value)) {
                            // ... (extracción de argTypeDescriptions sin cambios)
                        }
                    }
                });
            }
        },
        ExportNamedDeclaration(path: NodePath<ExportNamedDeclaration>) {
            if (isVariableDeclaration(path.node.declaration)) {
                path.node.declaration.declarations.forEach((declarator: VariableDeclarator) => {
                    if (isIdentifier(declarator.id) && isObjectExpression(declarator.init)) {
                        const storyName = declarator.id.name;
                        const argsProp = declarator.init.properties.find(
                            p => isObjectProperty(p) && isIdentifier(p.key) && p.key.name === 'args'
                        ) as ObjectProperty | undefined;

                        if (argsProp) {
                            const configuration = babelNodeToJsValue(argsProp.value);
                            if (configuration) {
                                ejemplos.push({ nombre: storyName, configuracion: configuration });
                            }
                        }
                    }
                });
            }
        }
    });

    return { componenteNombre, aiHint, ejemplos, argTypeDescriptions };
}

// NUEVO: Función para extraer datos de archivos MDX
async function extractMdxData(componentDir: string): Promise<ComponentDocumentation> {
    const docFile = path.join(componentDir, `${path.basename(componentDir)}.doc.mdx`);
    if (!fs.existsSync(docFile)) return {};

    const content = fs.readFileSync(docFile, 'utf-8');
    const tree = unified().use(remarkParse).use(remarkMdx).parse(content) as Root;
    
    const doc: ComponentDocumentation = {
        descripcionGeneral: '',
        anatomia: [],
        variantes: [],
        accesibilidad: [],
    };
    let currentSection: keyof ComponentDocumentation | null = null;

    visit(tree, (node) => {
        if (node.type === 'heading') {
            const headingText = (node.children[0] as any)?.value?.toLowerCase() || '';
            if (headingText.includes('descripción')) currentSection = 'descripcionGeneral';
            else if (headingText.includes('anatomía')) currentSection = 'anatomia';
            else if (headingText.includes('variantes')) currentSection = 'variantes';
            else if (headingText.includes('accesibilidad')) currentSection = 'accesibilidad';
            else currentSection = null;
        }

        if (node.type === 'paragraph' || node.type === 'listItem') {
            const textContent = (node.children.map((child: any) => child.value || '').join('')).trim();
            if (!textContent || !currentSection) return;

            if (currentSection === 'descripcionGeneral') doc.descripcionGeneral += textContent + ' ';
            if (currentSection === 'anatomia' && doc.anatomia) doc.anatomia.push(textContent);
            if (currentSection === 'accesibilidad' && doc.accesibilidad) doc.accesibilidad.push(textContent);
        }
    });
    
    // Limpieza final
    doc.descripcionGeneral = doc.descripcionGeneral?.trim();

    return doc;
}


async function buildKnowledgeBase() {
  const storyFiles = await glob(`${STORIES_PATH}/**/*.stories.ts`);
  const knowledgeBase: ComponentInfo[] = [];

  for (const storyFile of storyFiles) {
    console.log(`\n--- Procesando: ${path.basename(storyFile)} ---`);
    const content = fs.readFileSync(storyFile, 'utf-8');
    
    const relativeStoryPath = path.relative(STORIES_PATH, storyFile);
    const componentName = path.basename(relativeStoryPath, '.stories.ts');
    const componentDir = path.join(COMPONENTS_PATH, path.dirname(relativeStoryPath));
    const componentFile = path.join(componentDir, `${componentName}.component.ts`);

    const [componentData, storybookData, mdxData] = await Promise.all([
        extractComponentData(componentFile),
        extractStorybookData(content),
        extractMdxData(componentDir), // NUEVO: Extraer datos de MDX
    ]);

    if (!componentData || !componentData.selector || !storybookData.componenteNombre) {
      console.error(`      - ERROR: Faltan datos clave para ${path.basename(storyFile)}. Se omitirá.`);
      continue;
    }
    
    // MODIFICADO: Fusionar datos de todas las fuentes
    const mergedInputs = componentData.inputs.map(prop => {
      const descripcion = storybookData.argTypeDescriptions.get(prop.nombre);
      return { ...prop, ...(descripcion && { descripcion }) };
    });

    knowledgeBase.push({
      componenteNombre: storybookData.componenteNombre,
      selector: componentData.selector,
      aiHint: storybookData.aiHint || 'COMPLETAR HINT PARA LA IA',
      api: {
        inputs: mergedInputs,
        outputs: componentData.outputs,
      },
      documentacion: mdxData,
      ejemplos: storybookData.ejemplos,
    });
    
    console.log(`      - ÉXITO: Componente "${storybookData.componenteNombre}" agregado.`);
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(knowledgeBase, null, 2));
  console.log(`\n¡Listo! El archivo knowledge_base.json fue creado/actualizado en: ${OUTPUT_PATH}`);
}

buildKnowledgeBase();