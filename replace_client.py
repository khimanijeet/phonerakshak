import os

def replace_in_files(dir_path):
    for root, dirs, files in os.walk(dir_path):
        for file in files:
            if file.endswith('.kt'):
                filepath = os.path.join(root, file)
                with open(filepath, 'r', encoding='utf-8') as f:
                    content = f.read()
                
                # SetupActivity.kt handles registerDevice which RETURNS the token, so we need to save it.
                # Let's just do a simple string replace for the constructor everywhere first
                new_content = content.replace(
                    'BackendClient(prefs.backendUrl)',
                    'BackendClient(prefs.backendUrl, prefs.jwtToken)'
                )
                
                if new_content != content:
                    with open(filepath, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f"Updated {filepath}")

replace_in_files('app/src/main/java/com/example/phonerakshak')
