enum ReturnType {
    /**
     * True or false boolean value.
     */
    Boolean = "boolean",
    /**
     * Numerical value like int, float, double, ...
     */
    Number = "number",
    /**
     * Any value is possible.
     */
    Object = "object",
    /**
     * String value.
     */
    String = "string"
}

export function GetreturnTypeStrFromReturnType(returnType: ReturnType): string {
    let result = '';
    switch(returnType) {
        case ReturnType.Boolean: result = "boolean";break;
        case ReturnType.Number: result = "number";break;
        case ReturnType.Object: result = "any";break;
        case ReturnType.String: result = "string";break;
    }

    return result;
}