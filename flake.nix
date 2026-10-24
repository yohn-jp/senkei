{
  description = "Senkei reproducible hero production tools (no system changes)";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  outputs = { self, nixpkgs }: let
    systems = [ "x86_64-linux" "aarch64-linux" ];
  in {
    devShells = nixpkgs.lib.genAttrs systems (system: let pkgs = import nixpkgs { inherit system; }; in {
      default = pkgs.mkShell {
        packages = [ pkgs.blender pkgs.nodejs_24 pkgs.chromium ];
        shellHook = ''export SENKEI_CHROMIUM_EXECUTABLE="${pkgs.chromium}/bin/chromium"'';
      };
    });
  };
}
