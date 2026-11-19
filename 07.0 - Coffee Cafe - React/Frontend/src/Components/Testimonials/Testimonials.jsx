import React,{Component} from 'react';
import Slider from 'react-slick';

const TestimonialData = [
    {
      id: 1,
      name: "Tom Coffeeing",
      text: "Lorem ipsum dolor sit amet consectetur adipisicing elit. Eaque reiciendis inventore iste ratione ex alias quis magni at optio",
      img: "https://picsum.photos/101/101",
    },
    {
      id: 2,
      name: "John Doe",
      text: "Lorem ipsum dolor sit amet consectetur adipisicing elit. Eaque reiciendis inventore iste ratione ex alias quis magni at optio",
      img: "https://picsum.photos/102/102",
    },
    {
      id: 3,
      name: "Sam Fisher",
      text: "Lorem ipsum dolor sit amet consectetur adipisicing elit. Eaque reiciendis inventore iste ratione ex alias quis magni at optio",
      img: "https://picsum.photos/104/104",
    },
    {
      id: 5,
      name: "Daphne Hughe",
      text: "Lorem ipsum dolor sit amet consectetur adipisicing elit. Eaque reiciendis inventore iste ratione ex alias quis magni at optio",
      img: "https://picsum.photos/103/103",
    },
  ];
  
class AppStore extends Component{
    sliderSettings = {
        dots: true,
        arrows: false,
        infinite: true,
        speed: 500,
        slidesToScroll: 1,
        autoplay: true,
        autoplaySpeed: 2000,
        cssEase: "linear",
        pauseOnHover: true,
        pauseOnFocus: true,
        responsive: [
          {
            breakpoint: 10000,
            settings: {
              slidesToShow: 3,
              slidesToScroll: 1,
              infinite: true,
            },
          },
          {
            breakpoint: 1024,
            settings: {
              slidesToShow: 2,
              slidesToScroll: 1,
              initialSlide: 2,
            },
          },
          {
            breakpoint: 640,
            settings: {
              slidesToShow: 1,
              slidesToScroll: 1,
            },
          },
        ],
      };
    
    render(){
        return (
            <div className='py-14 mb-10'>
                <div className='container'>
                    {/* Header section */}
                    <div data-aos='fade-up' className='text-center mb-20'> 
                        <h1 className="text-4xl font-bold font-cursive text-grey-800">
                            Testimonials
                        </h1>
                    </div>
                    {/* Testimonials Card Section */}
                    <div data-aos='zoom-in'>
                      <Slider {...this.sliderSettings}>
                          {TestimonialData.map(  (testimonial, index) => {
                              return (
                                <div className="testimonial-card my-6" key={testimonial.id+'_'+index}>
                                    <div className="testimonial-card-image  flex flex-col gap-4 shadow-lg px-6 py-8 mx-4 rounded-xl bg-primary/10 relative">
                                        {/* Image Section */}
                                        <div className='mb-4'>
                                          <img src={testimonial.img} alt="" 
                                            className='rounded-full w-20 h-20'
                                          /> 
                                        </div>
                                        {/* content section */}
                                        <div className='flex flex-xol items-center gap-4'>
                                          <div className='space-y-3'>
                                            <p className='text-xs text-gray-500'>{testimonial.text}</p>
                                            <h1 className='text-xl text-black/70 font-bold font-cursive'>{testimonial.name}</h1>
                                          </div>
                                        </div>
                                        <p className="text-black/20 text-9xl font-serif absolute top-0 right-0">,,</p>
                                      </div>
                                </div>
                              )
                            }           
                          )}
                        </Slider>
                    </div>
                </div>
            </div>
        )
    }
}
export default AppStore;