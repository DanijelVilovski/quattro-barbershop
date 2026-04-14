import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './footer.html',
  styleUrls: ['./footer.scss'],
})
export class FooterComponent {
  hours = [
    { day: 'Ponedeljak', time: '12:00 – 20:00' },
    { day: 'Utorak', time: '12:00 – 20:00' },
    { day: 'Sreda', time: '12:00 – 20:00' },
    { day: 'Četvrtak', time: '12:00 – 20:00' },
    { day: 'Petak', time: '12:00 – 20:00' },
    { day: 'Subota', time: '10:00 – 17:00' },
    { day: 'Nedelja', time: 'Zatvoreno' },
  ];
}
